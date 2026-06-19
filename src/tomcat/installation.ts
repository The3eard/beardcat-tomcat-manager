import * as path from "path";
import * as os from "os";
import { exists, readText } from "../util/fs";

export interface InstallationProbe {
  valid: boolean;
  version?: string;
  reason?: string;
}

function catalinaScript(): string {
  return os.platform() === "win32" ? "bin/catalina.bat" : "bin/catalina.sh";
}

/** Validate a candidate CATALINA_HOME and try to read its version. */
export async function probeInstallation(catalinaHome: string): Promise<InstallationProbe> {
  const script = path.join(catalinaHome, catalinaScript());
  const catalinaJar = path.join(catalinaHome, "lib", "catalina.jar");
  if (!(await exists(script))) {
    return { valid: false, reason: `Missing ${catalinaScript()} under ${catalinaHome}` };
  }
  if (!(await exists(catalinaJar))) {
    return { valid: false, reason: `Missing lib/catalina.jar under ${catalinaHome}` };
  }
  const version = await readVersion(catalinaHome);
  return { valid: true, version };
}

async function readVersion(catalinaHome: string): Promise<string | undefined> {
  // RELEASE-NOTES carries a line like "Apache Tomcat Version 10.1.52".
  for (const file of ["RELEASE-NOTES", "README.md"]) {
    const p = path.join(catalinaHome, file);
    if (await exists(p)) {
      try {
        const text = await readText(p);
        const m = text.match(/Apache Tomcat Version\s+([\d.]+)/i);
        if (m) {
          return m[1];
        }
      } catch {
        /* ignore */
      }
    }
  }
  return undefined;
}

/** Suggest a display name from a CATALINA_HOME path. */
export function suggestName(catalinaHome: string, version?: string): string {
  if (version) {
    return `Tomcat ${version}`;
  }
  const base = path.basename(catalinaHome).replace(/^apache-/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function catalinaExecutable(catalinaHome: string): string {
  return path.join(catalinaHome, catalinaScript());
}
