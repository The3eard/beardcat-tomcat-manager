// VS Code OutputChannels render plain text, so ANSI escape sequences (colors,
// cursor moves) emitted by Maven/Catalina show up as garbage like "[34;1m".
// Strip them before appending. Built from char codes to keep this source ASCII.
const ESC = String.fromCharCode(0x1b); // ESC
const CSI = String.fromCharCode(0x9b); // 8-bit CSI
const ANSI = new RegExp(`[${ESC}${CSI}][[\\]()#;?]*(?:(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[@-~])`, "g");

export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}
