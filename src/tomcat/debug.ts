import * as vscode from "vscode";

const JAVA_DEBUG_EXTENSION = "vscjava.vscode-java-debug";

export function jdwpOptions(port: number): string {
  return `-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=*:${port}`;
}

/** Ensure the Java debugger extension is present, offering to install it on demand. */
export async function ensureJavaDebugExtension(): Promise<boolean> {
  if (vscode.extensions.getExtension(JAVA_DEBUG_EXTENSION)) {
    return true;
  }
  const pick = await vscode.window.showWarningMessage(
    "Debugging Tomcat requires the \"Debugger for Java\" extension.",
    "Install",
    "Cancel"
  );
  if (pick === "Install") {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", JAVA_DEBUG_EXTENSION);
    return vscode.extensions.getExtension(JAVA_DEBUG_EXTENSION) !== undefined;
  }
  return false;
}

/** Attach the Java debugger to a JDWP port. */
export async function attachDebugger(
  name: string,
  port: number,
  folder: vscode.WorkspaceFolder | undefined
): Promise<vscode.DebugSession | undefined> {
  const config: vscode.DebugConfiguration = {
    type: "java",
    name: `Tomcat: ${name}`,
    request: "attach",
    hostName: "localhost",
    port,
    // Hot Code Replace: when the Java language server recompiles a changed
    // method body, push the new bytecode into the running JVM over JDWP — no
    // rebuild/redeploy/restart. "auto" applies it on save automatically.
    hotCodeReplace: "auto"
  };
  const started = await vscode.debug.startDebugging(folder, config);
  if (!started) {
    return undefined;
  }
  return vscode.debug.activeDebugSession;
}
