import * as vscode from "vscode";
import * as fsp from "fs/promises";
import * as path from "path";

/**
 * Polls a CATALINA_BASE/logs directory and streams each Tomcat log file
 * (localhost, access log, manager, …) into its own Output channel, so they all
 * appear in the Output dropdown alongside the app console. catalina.* is skipped
 * because that content is already streamed to the main "Tomcat: <name>" channel.
 */
export class LogTailer {
  private timer: NodeJS.Timeout | undefined;
  private readonly offsets = new Map<string, number>();
  private readonly channels = new Map<string, vscode.OutputChannel>();

  constructor(private readonly configName: string, private readonly logsDir: string) {}

  start(): void {
    this.stop();
    this.offsets.clear();
    for (const c of this.channels.values()) {
      c.clear();
    }
    this.timer = setInterval(() => void this.poll(), 1000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    let entries: string[];
    try {
      entries = await fsp.readdir(this.logsDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!/\.(log|txt|out)$/i.test(name) || /^catalina/i.test(name)) {
        continue;
      }
      const full = path.join(this.logsDir, name);
      let size: number;
      try {
        size = (await fsp.stat(full)).size;
      } catch {
        continue;
      }
      const prev = this.offsets.get(name) ?? 0;
      if (size > prev) {
        await this.readFrom(name, full, prev, size);
      } else if (size < prev) {
        this.offsets.set(name, 0);
      }
    }
  }

  private async readFrom(name: string, full: string, from: number, to: number): Promise<void> {
    const buf = Buffer.alloc(to - from);
    let fh: fsp.FileHandle | undefined;
    try {
      fh = await fsp.open(full, "r");
      await fh.read(buf, 0, buf.length, from);
    } catch {
      return;
    } finally {
      await fh?.close();
    }
    this.offsets.set(name, to);
    this.channelFor(name).append(buf.toString("utf8"));
  }

  private channelFor(file: string): vscode.OutputChannel {
    const stem = file.replace(/[._-]?\d{4}-\d{2}-\d{2}/, "").replace(/\.(log|txt|out)$/i, "");
    const key = `Tomcat: ${this.configName} — ${stem || file}`;
    let c = this.channels.get(key);
    if (!c) {
      c = vscode.window.createOutputChannel(key);
      this.channels.set(key, c);
    }
    return c;
  }

  dispose(): void {
    this.stop();
    for (const c of this.channels.values()) {
      c.dispose();
    }
    this.channels.clear();
    this.offsets.clear();
  }
}
