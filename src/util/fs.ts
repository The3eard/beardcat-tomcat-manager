import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";

export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

export function existsSync(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await fsp.mkdir(p, { recursive: true });
}

/** Recursively copy a directory tree. Overwrites existing files. */
export async function copyDir(src: string, dest: string): Promise<void> {
  await ensureDir(dest);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(s, d);
    } else if (entry.isSymbolicLink()) {
      const link = await fsp.readlink(s);
      try {
        await fsp.symlink(link, d);
      } catch {
        /* ignore broken/duplicate links */
      }
    } else {
      await fsp.copyFile(s, d);
    }
  }
}

export async function rmrf(p: string): Promise<void> {
  await fsp.rm(p, { recursive: true, force: true });
}

export async function readText(p: string): Promise<string> {
  return fsp.readFile(p, "utf8");
}

export async function writeText(p: string, content: string): Promise<void> {
  await ensureDir(path.dirname(p));
  await fsp.writeFile(p, content, "utf8");
}
