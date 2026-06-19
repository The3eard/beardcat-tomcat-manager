import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { Store } from "../model/store";
import { ServerState, TomcatRunConfig } from "../model/types";
import { catalinaExecutable } from "./installation";
import { prepareBase, ResolvedDeployment } from "./catalinaBase";
import { DEFAULT_GOALS, FAST_RELOAD_GOALS, locateExploded, locateWar, runMaven } from "./maven";
import { attachDebugger, ensureJavaDebugExtension, jdwpOptions } from "./debug";
import { isPortFree, waitForPort } from "../util/ports";
import { channel } from "../util/log";
import { stripAnsi } from "../util/ansi";
import { LogTailer } from "./logTailer";

type LaunchMode = "run" | "debug";

/** Tomcat logs this once every webapp has finished deploying. */
const READY_LINE = /Server startup in \[?\d+\]?\s*(ms|milliseconds)/i;
const READY_TIMEOUT_MS = 300000;

interface RunningServer {
  child: cp.ChildProcess;
  baseDir: string;
  mode: LaunchMode;
  debugSession?: vscode.DebugSession;
}

export class ServerManager {
  private readonly running = new Map<string, RunningServer>();
  private readonly tailers = new Map<string, LogTailer>();
  private readonly states = new Map<string, ServerState>();
  private readonly stateEmitter = new vscode.EventEmitter<string>();
  readonly onDidChangeState = this.stateEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext, private readonly store: Store) {}

  getState(configId: string): ServerState {
    return this.states.get(configId) ?? "stopped";
  }

  private setState(configId: string, state: ServerState): void {
    this.states.set(configId, state);
    this.stateEmitter.fire(configId);
  }

  // ---- lifecycle -----------------------------------------------------------

  async start(config: TomcatRunConfig, mode: LaunchMode): Promise<void> {
    if (this.running.has(config.id)) {
      vscode.window.showInformationMessage(`"${config.name}" is already running.`);
      return;
    }
    const installation = this.store.getInstallation(config.installationId);
    if (!installation) {
      vscode.window.showErrorMessage(`Configuration "${config.name}" references a missing Tomcat installation.`);
      return;
    }
    if (mode === "debug" && !(await ensureJavaDebugExtension())) {
      return;
    }

    const out = channel(`Tomcat: ${config.name}`);
    out.show(true);
    this.setState(config.id, "starting");

    try {
      await this.assertPortFree(config.httpPort, "HTTP");
      if (config.httpsPort) {
        await this.assertPortFree(config.httpsPort, "HTTPS");
      }
      const deployments = await this.buildAndResolve(config, out);
      const baseDir = this.baseDirFor(config.id);
      const shutdownPort = await this.allocate(this.cfgNumber("shutdownPortBase", 8005));
      await prepareBase(config, installation, baseDir, shutdownPort, deployments);

      const env: NodeJS.ProcessEnv = { ...process.env };
      env.CATALINA_HOME = installation.path;
      env.CATALINA_BASE = baseDir;
      const jre = config.jrePath?.trim() || this.cfgString("defaultJrePath");
      if (jre) {
        env.JAVA_HOME = jre;
      }

      let debugPort: number | undefined;
      const opts: string[] = [];
      if (config.vmOptions.trim()) {
        opts.push(config.vmOptions.trim());
      }
      if (mode === "debug") {
        debugPort = await this.allocate(this.cfgNumber("debugPortBase", 8000));
        opts.push(jdwpOptions(debugPort));
      }
      env.CATALINA_OPTS = opts.join(" ");

      const exec = catalinaExecutable(installation.path);
      out.appendLine(`[beardcat] CATALINA_BASE=${baseDir}`);
      out.appendLine(`[beardcat] ${exec} run  (HTTP ${config.httpPort}, shutdown ${shutdownPort}${debugPort ? `, debug ${debugPort}` : ""})`);

      const child = cp.spawn(exec, ["run"], { env, shell: os.platform() === "win32" });
      const server: RunningServer = { child, baseDir, mode };
      this.running.set(config.id, server);

      // Resolves once Tomcat logs "Server startup in …" — i.e. every webapp has
      // finished deploying, not merely when the connector port opened.
      let markReady: () => void = () => undefined;
      const appReady = new Promise<void>((resolve) => (markReady = resolve));
      let tail = "";
      const onData = (d: Buffer): void => {
        const text = stripAnsi(d.toString());
        out.append(text);
        tail = (tail + text).slice(-2048);
        if (READY_LINE.test(tail)) {
          markReady();
        }
      };
      child.stdout?.on("data", onData);
      child.stderr?.on("data", onData);
      child.on("error", (e) => {
        out.appendLine(`[beardcat] launch error: ${e.message}`);
        vscode.window.showErrorMessage(`Failed to launch Tomcat: ${e.message}`);
      });
      child.on("close", (code) => {
        out.appendLine(`[beardcat] Tomcat process exited (code ${code ?? "?"}).`);
        this.tailers.get(config.id)?.stop();
        this.running.delete(config.id);
        this.setState(config.id, "stopped");
      });

      // Stream the rest of Tomcat's log files (localhost, access log, …) to the Output dropdown.
      let tailer = this.tailers.get(config.id);
      if (!tailer) {
        tailer = new LogTailer(config.name, path.join(baseDir, "logs"));
        this.tailers.set(config.id, tailer);
      }
      tailer.start();

      if (mode === "debug" && debugPort !== undefined) {
        await waitForPort("localhost", debugPort, 60000).catch(() => undefined);
        const folder = vscode.workspace.workspaceFolders?.[0];
        server.debugSession = await attachDebugger(config.name, debugPort, folder);
      }

      // Wait for genuine readiness, with a timeout fallback. If the process died
      // during startup the close handler already removed it — bail out then.
      const outcome = await Promise.race([
        appReady.then(() => "ready" as const),
        this.delay(READY_TIMEOUT_MS).then(() => "timeout" as const)
      ]);
      if (!this.running.has(config.id)) {
        return;
      }
      if (outcome === "timeout") {
        out.appendLine("[beardcat] App readiness ('Server startup in …') not detected within timeout; continuing anyway.");
      }
      this.setState(config.id, mode === "debug" ? "debugging" : "running");

      if (config.openBrowser) {
        await this.openBrowser(config);
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      out.appendLine(`[beardcat] start failed: ${message}`);
      vscode.window.showErrorMessage(`Tomcat "${config.name}" failed to start: ${message}`);
      await this.stop(config.id);
      this.setState(config.id, "stopped");
    }
  }

  async stop(configId: string): Promise<void> {
    const server = this.running.get(configId);
    if (!server) {
      this.setState(configId, "stopped");
      return;
    }
    this.setState(configId, "stopping");
    this.tailers.get(configId)?.stop();
    if (server.debugSession) {
      await vscode.debug.stopDebugging(server.debugSession).then(undefined, () => undefined);
    }
    await this.killTree(server.child);
    this.running.delete(configId);
    this.setState(configId, "stopped");
  }

  async restart(config: TomcatRunConfig): Promise<void> {
    const wasDebug = this.getState(config.id) === "debugging";
    await this.stop(config.id);
    await this.start(config, wasDebug ? "debug" : "run");
  }

  /** Honor the configuration's "On update" action. */
  async redeploy(config: TomcatRunConfig): Promise<void> {
    if (!this.running.has(config.id)) {
      return;
    }
    if (config.onUpdate === "restart") {
      await this.restart(config);
      return;
    }

    const out = channel(`Tomcat: ${config.name}`);
    out.show(true);

    // Fast path: for exploded Maven deployments, recompile only what changed and
    // re-explode (no clean, no package, no restart). The reloadable context then
    // reloads automatically. Falls back to restart when nothing can hot-reload.
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const modules = new Set<string>();
    let hasNonReloadable = false;
    for (const dep of config.deployments) {
      if (dep.type === "exploded" && dep.source === "maven") {
        const moduleDir = dep.mavenModule?.trim() || root;
        if (moduleDir) {
          modules.add(moduleDir);
        }
      } else {
        hasNonReloadable = true;
      }
    }

    if (modules.size === 0) {
      out.appendLine("[beardcat] Nothing to hot-reload (no exploded Maven deployment); restarting instead.");
      await this.restart(config);
      return;
    }

    try {
      const jre = config.jrePath?.trim() || this.cfgString("defaultJrePath");
      for (const moduleDir of modules) {
        await runMaven(moduleDir, FAST_RELOAD_GOALS, jre, out);
      }
      out.appendLine(
        "[beardcat] Recompiled and re-exploded. Tomcat will reload the context automatically " +
          "(reloadable). If you are debugging, unchanged-signature edits also hot-swap live."
      );
      if (hasNonReloadable) {
        out.appendLine("[beardcat] Note: WAR / path deployments are not hot-reloaded — use Restart for those.");
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Reload failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async openBrowser(config: TomcatRunConfig): Promise<void> {
    const url = config.browserUrl?.trim() || `http://localhost:${config.httpPort}/`;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  showLogs(config: TomcatRunConfig): void {
    channel(`Tomcat: ${config.name}`).show(false);
  }

  // ---- helpers -------------------------------------------------------------

  private async buildAndResolve(config: TomcatRunConfig, out: vscode.OutputChannel): Promise<ResolvedDeployment[]> {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const builtModules = new Set<string>();
    const resolved: ResolvedDeployment[] = [];

    for (const dep of config.deployments) {
      if (dep.source === "path") {
        if (!dep.artifactPath) {
          throw new Error(`Deployment "${dep.contextPath}" has no artifact path.`);
        }
        resolved.push({ ...dep, docBase: dep.artifactPath });
        continue;
      }
      const moduleDir = dep.mavenModule?.trim() || root;
      if (!moduleDir) {
        throw new Error("No Maven module / workspace folder to build from.");
      }
      if (config.buildBeforeLaunch && !builtModules.has(moduleDir)) {
        const goals = config.mvnGoals?.trim() || DEFAULT_GOALS;
        await runMaven(moduleDir, goals, config.jrePath?.trim() || this.cfgString("defaultJrePath"), out);
        builtModules.add(moduleDir);
      }
      const docBase = dep.type === "war" ? await locateWar(moduleDir) : await locateExploded(moduleDir);
      if (!docBase) {
        throw new Error(`Could not find a built ${dep.type} artifact under ${moduleDir}/target.`);
      }
      resolved.push({ ...dep, docBase });
    }
    return resolved;
  }

  private baseDirFor(configId: string): string {
    const root = this.context.storageUri?.fsPath ?? path.join(os.tmpdir(), "beardcat");
    return path.join(root, "bases", configId);
  }

  private async assertPortFree(port: number, label: string): Promise<void> {
    if (!(await isPortFree(port))) {
      throw new Error(
        `${label} port ${port} is already in use — another Tomcat or process is bound to it. ` +
          `Stop it (e.g. "lsof -ti :${port} | xargs kill") or change the ${label} port in the configuration.`
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async allocate(base: number): Promise<number> {
    for (let port = base; port < base + 200; port++) {
      if (await isPortFree(port)) {
        return port;
      }
    }
    return base;
  }

  private cfgNumber(key: string, fallback: number): number {
    return vscode.workspace.getConfiguration("beardcat").get<number>(key, fallback);
  }

  private cfgString(key: string): string {
    return vscode.workspace.getConfiguration("beardcat").get<string>(key, "").trim();
  }

  private killTree(child: cp.ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      if (child.exitCode !== null || child.pid === undefined) {
        resolve();
        return;
      }
      const pid = child.pid;
      const done = (): void => resolve();
      child.once("close", done);
      try {
        if (os.platform() === "win32") {
          cp.spawn("taskkill", ["/pid", String(pid), "/T", "/F"]);
        } else {
          process.kill(pid, "SIGTERM");
          setTimeout(() => {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              /* already gone */
            }
          }, 8000);
        }
      } catch {
        resolve();
      }
    });
  }

  async dispose(): Promise<void> {
    for (const id of [...this.running.keys()]) {
      await this.stop(id);
    }
    for (const tailer of this.tailers.values()) {
      tailer.dispose();
    }
    this.tailers.clear();
    this.stateEmitter.dispose();
  }
}
