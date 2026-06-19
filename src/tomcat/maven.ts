import * as cp from "child_process";
import * as os from "os";
import * as path from "path";
import * as fsp from "fs/promises";
import * as vscode from "vscode";
import { exists } from "../util/fs";
import { stripAnsi } from "../util/ansi";

export const DEFAULT_GOALS = "package -DskipTests";
/** Incremental rebuild for hot reload: recompile changed sources and re-sync the
 * exploded webapp (classes + resources) without clean/package or a restart. */
export const FAST_RELOAD_GOALS = "compile war:exploded -DskipTests";

function mvnExecutable(): string {
  const configured = vscode.workspace.getConfiguration("beardcat").get<string>("mvnPath", "").trim();
  if (configured) {
    return configured;
  }
  return os.platform() === "win32" ? "mvn.cmd" : "mvn";
}

/** Run a Maven build in a module directory, streaming output to the channel. */
export function runMaven(
  moduleDir: string,
  goals: string,
  jrePath: string | undefined,
  out: vscode.OutputChannel
): Promise<void> {
  const exec = mvnExecutable();
  const args = goals.split(/\s+/).filter(Boolean);
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (jrePath) {
    env.JAVA_HOME = jrePath;
  }
  out.appendLine(`\n[beardcat] ${exec} ${args.join(" ")}  (cwd: ${moduleDir})`);
  return new Promise((resolve, reject) => {
    const child = cp.spawn(exec, args, { cwd: moduleDir, env, shell: os.platform() === "win32" });
    child.stdout.on("data", (d: Buffer) => out.append(stripAnsi(d.toString())));
    child.stderr.on("data", (d: Buffer) => out.append(stripAnsi(d.toString())));
    child.on("error", (e) =>
      reject(new Error(`Failed to launch Maven ("${exec}"). Set "beardcat.mvnPath" or add mvn to PATH. ${e.message}`))
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Maven build failed (exit ${code}). See the build output.`));
      }
    });
  });
}

/** Newest .war under <moduleDir>/target. */
export async function locateWar(moduleDir: string): Promise<string | undefined> {
  const targetDir = path.join(moduleDir, "target");
  if (!(await exists(targetDir))) {
    return undefined;
  }
  const entries = await fsp.readdir(targetDir);
  const wars = entries.filter((e) => e.toLowerCase().endsWith(".war"));
  return newestPath(targetDir, wars);
}

/** Newest exploded webapp directory (contains WEB-INF) under <moduleDir>/target. */
export async function locateExploded(moduleDir: string): Promise<string | undefined> {
  const targetDir = path.join(moduleDir, "target");
  if (!(await exists(targetDir))) {
    return undefined;
  }
  const entries = await fsp.readdir(targetDir, { withFileTypes: true });
  const candidates: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && (await exists(path.join(targetDir, entry.name, "WEB-INF")))) {
      candidates.push(entry.name);
    }
  }
  return newestPath(targetDir, candidates);
}

async function newestPath(dir: string, names: string[]): Promise<string | undefined> {
  let best: { p: string; mtime: number } | undefined;
  for (const name of names) {
    const p = path.join(dir, name);
    const st = await fsp.stat(p);
    if (!best || st.mtimeMs > best.mtime) {
      best = { p, mtime: st.mtimeMs };
    }
  }
  return best?.p;
}
