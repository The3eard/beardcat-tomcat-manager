import * as vscode from "vscode";
import * as path from "path";
import { TomcatInstallation, TomcatRunConfig } from "./types";
import { exists, readText, writeText } from "../util/fs";

const INSTALLATIONS_KEY = "beardcat.installations";
const PROJECT_FILE = ".vscode/beardcat-tomcat.json";

interface ProjectFile {
  version: 1;
  configs: TomcatRunConfig[];
}

/**
 * Persists Tomcat installations in machine-global state (paths are machine-specific)
 * and run configurations in a shareable project file (".vscode/beardcat-tomcat.json"),
 * mirroring IntelliJ's "Store as project file".
 */
export class Store {
  private readonly onDidChangeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.onDidChangeEmitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  // ---- installations -------------------------------------------------------

  getInstallations(): TomcatInstallation[] {
    return this.context.globalState.get<TomcatInstallation[]>(INSTALLATIONS_KEY, []);
  }

  getInstallation(id: string): TomcatInstallation | undefined {
    return this.getInstallations().find((i) => i.id === id);
  }

  async saveInstallation(installation: TomcatInstallation): Promise<void> {
    const all = this.getInstallations().filter((i) => i.id !== installation.id);
    all.push(installation);
    await this.context.globalState.update(INSTALLATIONS_KEY, all);
    this.onDidChangeEmitter.fire();
  }

  async deleteInstallation(id: string): Promise<void> {
    const all = this.getInstallations().filter((i) => i.id !== id);
    await this.context.globalState.update(INSTALLATIONS_KEY, all);
    this.onDidChangeEmitter.fire();
  }

  // ---- configurations ------------------------------------------------------

  private projectFileUri(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    return vscode.Uri.file(path.join(folder.uri.fsPath, PROJECT_FILE));
  }

  private configsCache: TomcatRunConfig[] | undefined;

  async getConfigs(): Promise<TomcatRunConfig[]> {
    if (this.configsCache) {
      return this.configsCache;
    }
    const uri = this.projectFileUri();
    if (uri && (await exists(uri.fsPath))) {
      try {
        const parsed = JSON.parse(await readText(uri.fsPath)) as ProjectFile;
        this.configsCache = parsed.configs ?? [];
      } catch {
        this.configsCache = [];
      }
    } else {
      this.configsCache = [];
    }
    return this.configsCache;
  }

  async getConfig(id: string): Promise<TomcatRunConfig | undefined> {
    return (await this.getConfigs()).find((c) => c.id === id);
  }

  async saveConfig(config: TomcatRunConfig): Promise<void> {
    const all = (await this.getConfigs()).filter((c) => c.id !== config.id);
    all.push(config);
    await this.persistConfigs(all);
  }

  async deleteConfig(id: string): Promise<void> {
    const all = (await this.getConfigs()).filter((c) => c.id !== id);
    await this.persistConfigs(all);
  }

  private async persistConfigs(configs: TomcatRunConfig[]): Promise<void> {
    this.configsCache = configs;
    const uri = this.projectFileUri();
    if (uri) {
      const payload: ProjectFile = { version: 1, configs };
      await writeText(uri.fsPath, JSON.stringify(payload, null, 2) + "\n");
    }
    this.onDidChangeEmitter.fire();
  }

  dispose(): void {
    this.onDidChangeEmitter.dispose();
  }
}
