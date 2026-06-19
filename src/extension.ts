import * as vscode from "vscode";
import { Store } from "./model/store";
import { defaultConfig, TomcatInstallation, TomcatRunConfig } from "./model/types";
import { ServerManager } from "./tomcat/server";
import { probeInstallation, suggestName } from "./tomcat/installation";
import { ConfigEditor } from "./view/configEditor";
import { ConfigNode, TomcatTreeProvider } from "./view/tree";
import { disposeAllChannels } from "./util/log";

let servers: ServerManager;

export function activate(context: vscode.ExtensionContext): void {
  const store = new Store(context);
  servers = new ServerManager(context, store);
  const tree = new TomcatTreeProvider(store, servers);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("beardcat.servers", tree),
    store,
    { dispose: () => disposeAllChannels() }
  );

  const resolveConfig = async (arg: unknown): Promise<TomcatRunConfig | undefined> => {
    if (arg instanceof ConfigNode) {
      return arg.config;
    }
    const configs = await store.getConfigs();
    if (configs.length === 0) {
      vscode.window.showInformationMessage("No Tomcat configurations yet. Use “Add Configuration”.");
      return undefined;
    }
    if (configs.length === 1) {
      return configs[0];
    }
    const pick = await vscode.window.showQuickPick(
      configs.map((c) => ({ label: c.name, config: c })),
      { placeHolder: "Select a Tomcat configuration" }
    );
    return pick?.config;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand("beardcat.refresh", () => tree.refresh()),
    vscode.commands.registerCommand("beardcat.addServer", () => addServer(store)),
    vscode.commands.registerCommand("beardcat.manageInstallations", () => manageInstallations(store)),
    vscode.commands.registerCommand("beardcat.addConfig", () => addConfig(context, store)),
    vscode.commands.registerCommand("beardcat.editConfig", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        ConfigEditor.show(context, store, c);
      }
    }),
    vscode.commands.registerCommand("beardcat.deleteConfig", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await deleteConfig(store, c);
      }
    }),
    vscode.commands.registerCommand("beardcat.run", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await servers.start(c, "run");
      }
    }),
    vscode.commands.registerCommand("beardcat.debug", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await servers.start(c, "debug");
      }
    }),
    vscode.commands.registerCommand("beardcat.stop", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await servers.stop(c.id);
      }
    }),
    vscode.commands.registerCommand("beardcat.restart", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await servers.restart(c);
      }
    }),
    vscode.commands.registerCommand("beardcat.redeploy", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await servers.redeploy(c);
      }
    }),
    vscode.commands.registerCommand("beardcat.openBrowser", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        await servers.openBrowser(c);
      }
    }),
    vscode.commands.registerCommand("beardcat.showLogs", async (a) => {
      const c = await resolveConfig(a);
      if (c) {
        servers.showLogs(c);
      }
    })
  );
}

export async function deactivate(): Promise<void> {
  if (servers) {
    await servers.dispose();
  }
}

// ---- command implementations -----------------------------------------------

async function addServer(store: Store): Promise<TomcatInstallation | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Select CATALINA_HOME"
  });
  if (!picked?.[0]) {
    return undefined;
  }
  const home = picked[0].fsPath;
  const probe = await probeInstallation(home);
  if (!probe.valid) {
    vscode.window.showErrorMessage(`Not a valid Tomcat installation: ${probe.reason}`);
    return undefined;
  }
  const name = await vscode.window.showInputBox({
    prompt: "Name for this Tomcat installation",
    value: suggestName(home, probe.version)
  });
  if (name === undefined) {
    return undefined;
  }
  const installation: TomcatInstallation = { id: randomId(), name, path: home, version: probe.version };
  await store.saveInstallation(installation);
  vscode.window.showInformationMessage(`Added Tomcat installation "${name}".`);
  return installation;
}

async function manageInstallations(store: Store): Promise<void> {
  const installations = store.getInstallations();
  if (installations.length === 0) {
    const add = await vscode.window.showInformationMessage("No installations registered.", "Add");
    if (add === "Add") {
      await addServer(store);
    }
    return;
  }
  const pick = await vscode.window.showQuickPick(
    installations.map((i) => ({ label: i.name, description: i.path, detail: i.version, inst: i })),
    { placeHolder: "Select an installation to remove" }
  );
  if (!pick) {
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Remove installation "${pick.inst.name}"?`,
    { modal: true },
    "Remove"
  );
  if (confirm === "Remove") {
    await store.deleteInstallation(pick.inst.id);
  }
}

async function addConfig(context: vscode.ExtensionContext, store: Store): Promise<void> {
  let installations = store.getInstallations();
  if (installations.length === 0) {
    const added = await addServer(store);
    if (!added) {
      return;
    }
    installations = store.getInstallations();
  }
  const config = defaultConfig(randomId(), installations[0].id);
  config.deployments.push({ type: "exploded", source: "maven", contextPath: "/" });
  await store.saveConfig(config);
  ConfigEditor.show(context, store, config);
}

async function deleteConfig(store: Store, config: TomcatRunConfig): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Delete configuration "${config.name}"?`,
    { modal: true },
    "Delete"
  );
  if (confirm === "Delete") {
    await servers.stop(config.id);
    await store.deleteConfig(config.id);
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
