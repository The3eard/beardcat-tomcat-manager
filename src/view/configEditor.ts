import * as vscode from "vscode";
import { Store } from "../model/store";
import { TomcatRunConfig } from "../model/types";

/** Opens the IntelliJ-style configuration editor as a webview panel. */
export class ConfigEditor {
  private static panels = new Map<string, ConfigEditor>();

  static show(context: vscode.ExtensionContext, store: Store, config: TomcatRunConfig): void {
    const existing = ConfigEditor.panels.get(config.id);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    new ConfigEditor(context, store, config);
  }

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: Store,
    private config: TomcatRunConfig
  ) {
    this.panel = vscode.window.createWebviewPanel("beardcat.configEditor", config.name, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "media")]
    });
    this.panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "cat.svg");
    ConfigEditor.panels.set(config.id, this);

    this.panel.webview.html = this.html();
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  private async onMessage(message: { type: string; [k: string]: unknown }): Promise<void> {
    switch (message.type) {
      case "ready":
        this.post();
        return;
      case "save": {
        const incoming = message.config as TomcatRunConfig;
        this.config = { ...incoming, id: this.config.id };
        await this.store.saveConfig(this.config);
        this.panel.title = this.config.name;
        vscode.window.showInformationMessage(`Saved Tomcat configuration "${this.config.name}".`);
        if (message.close) {
          this.panel.dispose();
        }
        return;
      }
      case "cancel":
        this.panel.dispose();
        return;
      case "browse": {
        const folders = message.folders === true;
        const picked = await vscode.window.showOpenDialog({
          canSelectFiles: !folders,
          canSelectFolders: folders,
          canSelectMany: false,
          openLabel: "Select"
        });
        this.panel.webview.postMessage({
          type: "browseResult",
          field: message.field,
          index: message.index,
          path: picked?.[0]?.fsPath ?? ""
        });
        return;
      }
    }
  }

  private post(): void {
    this.panel.webview.postMessage({
      type: "init",
      config: this.config,
      installations: this.store.getInstallations()
    });
  }

  private html(): string {
    const webview = this.panel.webview;
    const nonce = nonceString();
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "config-editor.js"));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "config-editor.css"));
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Tomcat Configuration</title>
</head>
<body>
  <header class="topbar">
    <label class="name-field">Name
      <input id="name" type="text" />
    </label>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="server">Server</button>
    <button class="tab" data-tab="deployment">Deployment</button>
  </nav>

  <section class="panel active" id="panel-server">
    <div class="row"><label>Application server</label>
      <select id="installationId"></select>
    </div>
    <div class="row"><label>Open browser</label>
      <span><input type="checkbox" id="openBrowser" /> After launch &nbsp; URL
        <input type="text" id="browserUrl" class="grow" placeholder="http://localhost:8080/" />
      </span>
    </div>
    <div class="row"><label>VM options</label>
      <input type="text" id="vmOptions" class="grow" placeholder="-Xmx2g -Duser.timezone=Europe/Madrid" />
    </div>
    <div class="row"><label>On 'Update' action</label>
      <select id="onUpdate">
        <option value="restart">Restart server</option>
        <option value="redeploy">Hot reload (recompile changed classes, no full build)</option>
      </select>
    </div>
    <div class="row"><label>JRE (JAVA_HOME)</label>
      <span class="grow browse">
        <input type="text" id="jrePath" class="grow" placeholder="default (JAVA_HOME)" />
        <button class="browse-btn" data-field="jrePath" data-folders="true">…</button>
      </span>
    </div>
    <fieldset>
      <legend>Tomcat Server Settings</legend>
      <div class="row"><label>HTTP port</label><input type="number" id="httpPort" /></div>
      <div class="row"><label>HTTPS port</label><input type="number" id="httpsPort" placeholder="(optional)" /></div>
      <div class="row"><label>AJP port</label><input type="number" id="ajpPort" placeholder="(optional)" /></div>
    </fieldset>
    <div class="row"><label>Build before launch</label>
      <span><input type="checkbox" id="buildBeforeLaunch" /> Run Maven before launch &nbsp; goals
        <input type="text" id="mvnGoals" class="grow" placeholder="package -DskipTests" />
      </span>
    </div>
  </section>

  <section class="panel" id="panel-deployment">
    <div class="help-box">
      <p><strong>What gets deployed when the server starts.</strong> Add one entry per web app.</p>
      <ul>
        <li><strong>Type</strong> — <code>war</code> deploys the packaged <code>.war</code>; <code>exploded</code> deploys the unpacked folder (faster iteration, hot reload).</li>
        <li><strong>Source = maven</strong> — the extension runs your Maven build and finds the artifact under <code>target/</code> automatically. Set <em>Module</em> to the folder with the <code>pom.xml</code>, or leave it blank to use the workspace root.</li>
        <li><strong>Source = path</strong> — you point directly at an artifact you already built (a <code>.war</code> file, or an exploded directory).</li>
        <li><strong>Context</strong> — the URL path the app is served at. <code>/</code> = root (e.g. <code>http://localhost:8080/</code>); <code>/app</code> = <code>…/app</code>.</li>
      </ul>
      <p class="hint">💡 Use <code>exploded</code> for the fastest dev loop: the <strong>Reload</strong> action recompiles only changed classes (no full build) and Tomcat reloads the context. While <strong>Debugging</strong>, method-body edits hot-swap into the running JVM instantly — no reload at all.</p>
    </div>
    <div id="deployments"></div>
    <button id="addDeployment" class="secondary">+ Add deployment</button>
  </section>

  <footer class="actions">
    <button id="cancel" class="secondary">Cancel</button>
    <button id="apply">Apply</button>
    <button id="ok" class="primary">OK</button>
  </footer>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    ConfigEditor.panels.delete(this.config.id);
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}

function nonceString(): string {
  let text = "";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
