import * as vscode from "vscode";
import { Store } from "../model/store";
import { ServerManager } from "../tomcat/server";
import { ServerState, TomcatRunConfig } from "../model/types";

type Node = ConfigNode | DetailNode;

export class ConfigNode extends vscode.TreeItem {
  constructor(readonly config: TomcatRunConfig, state: ServerState, installationName: string) {
    super(config.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = `config.${state}`;
    this.description = describeState(state, installationName);
    this.iconPath = stateIcon(state);
    this.tooltip = `${config.name} — ${installationName} (HTTP ${config.httpPort})`;
    this.id = config.id;
  }
}

class DetailNode extends vscode.TreeItem {
  constructor(label: string, value: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = value;
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = "detail";
  }
}

export class TomcatTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly changeEmitter = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly store: Store, private readonly servers: ServerManager) {
    store.onDidChange(() => this.refresh());
    servers.onDidChangeState(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const configs = await this.store.getConfigs();
      configs.sort((a, b) => a.name.localeCompare(b.name));
      return configs.map((c) => {
        const inst = this.store.getInstallation(c.installationId);
        return new ConfigNode(c, this.servers.getState(c.id), inst?.name ?? "missing install");
      });
    }
    if (element instanceof ConfigNode) {
      return this.detailsFor(element.config);
    }
    return [];
  }

  private detailsFor(config: TomcatRunConfig): DetailNode[] {
    const inst = this.store.getInstallation(config.installationId);
    const nodes: DetailNode[] = [];
    nodes.push(new DetailNode("Server", inst ? `${inst.name}` : "missing", "server-environment"));
    nodes.push(new DetailNode("HTTP port", String(config.httpPort), "plug"));
    if (config.httpsPort) {
      nodes.push(new DetailNode("HTTPS port", String(config.httpsPort), "lock"));
    }
    for (const dep of config.deployments) {
      const src = dep.source === "maven" ? dep.mavenModule || "workspace root" : dep.artifactPath || "?";
      nodes.push(new DetailNode(`Deploy (${dep.type})`, `${dep.contextPath} ← ${src}`, "package"));
    }
    if (config.deployments.length === 0) {
      nodes.push(new DetailNode("Deploy", "none configured", "warning"));
    }
    return nodes;
  }
}

function stateIcon(state: ServerState): vscode.ThemeIcon {
  switch (state) {
    case "running":
      return new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor("charts.green"));
    case "debugging":
      return new vscode.ThemeIcon("debug-alt", new vscode.ThemeColor("charts.orange"));
    case "starting":
    case "stopping":
      return new vscode.ThemeIcon("loading~spin");
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

function describeState(state: ServerState, installationName: string): string {
  if (state === "stopped") {
    return installationName;
  }
  return `${state} · ${installationName}`;
}
