import * as vscode from "vscode";

const channels = new Map<string, vscode.OutputChannel>();

/** Shared diagnostic channel for the extension itself. */
export function extLog(): vscode.OutputChannel {
  return channel("BeardCat");
}

/** Per-configuration log channel (catalina output, build output). */
export function channel(name: string): vscode.OutputChannel {
  let c = channels.get(name);
  if (!c) {
    c = vscode.window.createOutputChannel(name);
    channels.set(name, c);
  }
  return c;
}

export function disposeChannel(name: string): void {
  const c = channels.get(name);
  if (c) {
    c.dispose();
    channels.delete(name);
  }
}

export function disposeAllChannels(): void {
  for (const c of channels.values()) {
    c.dispose();
  }
  channels.clear();
}
