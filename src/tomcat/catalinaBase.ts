import * as path from "path";
import { TomcatInstallation, TomcatRunConfig, Deployment } from "../model/types";
import { copyDir, ensureDir, exists, readText, rmrf, writeText } from "../util/fs";

export interface ResolvedDeployment extends Deployment {
  /** Absolute docBase: the exploded directory or the .war file. */
  docBase: string;
}

export interface BaseLayout {
  baseDir: string;
  shutdownPort: number;
}

/**
 * Materialize an isolated CATALINA_BASE for a configuration so the shared
 * CATALINA_HOME is never mutated (the approach IntelliJ uses). Copies conf/,
 * patches server.xml ports and writes one context descriptor per deployment.
 */
export async function prepareBase(
  config: TomcatRunConfig,
  installation: TomcatInstallation,
  baseDir: string,
  shutdownPort: number,
  deployments: ResolvedDeployment[]
): Promise<void> {
  // Fresh conf/logs/work/temp each launch so log tailing starts clean and no
  // stale compiled JSPs linger; webapps is kept (deployments use context docBase).
  for (const dir of ["conf", "logs", "work", "temp"]) {
    await rmrf(path.join(baseDir, dir));
  }
  for (const sub of ["conf", "logs", "work", "temp", "webapps", "conf/Catalina/localhost"]) {
    await ensureDir(path.join(baseDir, sub));
  }

  const srcConf = path.join(installation.path, "conf");
  if (await exists(srcConf)) {
    await copyDir(srcConf, path.join(baseDir, "conf"));
  }

  const serverXmlPath = path.join(baseDir, "conf", "server.xml");
  if (await exists(serverXmlPath)) {
    const xml = await readText(serverXmlPath);
    await writeText(
      serverXmlPath,
      patchServerXml(xml, {
        shutdownPort,
        httpPort: config.httpPort,
        httpsPort: config.httpsPort,
        ajpPort: config.ajpPort
      })
    );
  }

  // Remove any context descriptors carried over, then write ours.
  await rmrf(path.join(baseDir, "conf", "Catalina", "localhost"));
  await ensureDir(path.join(baseDir, "conf", "Catalina", "localhost"));
  for (const dep of deployments) {
    await writeContextDescriptor(baseDir, dep);
  }
}

interface PortPatch {
  shutdownPort: number;
  httpPort: number;
  httpsPort?: number;
  ajpPort?: number;
}

export function patchServerXml(xml: string, ports: PortPatch): string {
  let out = xml;

  // Shutdown port on the <Server> element.
  out = out.replace(/(<Server\b[^>]*\bport=")\d+(")/, `$1${ports.shutdownPort}$2`);

  // Rewrite each connector by protocol. Matches both self-closing connectors
  // (<Connector ... />) and container connectors that wrap an <SSLHostConfig>
  // (<Connector ...> ... </Connector>). The self-closing form is tried FIRST:
  // since [^>]* cannot cross a ">", it matches a single self-closing tag without
  // overrunning into a following connector's </Connector>.
  const connectorRe = /<Connector\b[^>]*\/>|<Connector\b[^>]*>[\s\S]*?<\/Connector>/g;
  out = out.replace(connectorRe, (tag) => {
    const protocol = (tag.match(/protocol="([^"]*)"/)?.[1] ?? "HTTP/1.1").toUpperCase();
    if (protocol.includes("AJP")) {
      if (ports.ajpPort === undefined) {
        return tag;
      }
      return setAttr(tag, "port", String(ports.ajpPort));
    }
    // A secure (SSL/TLS) connector maps to the HTTPS port. When no HTTPS port is
    // configured we disable it entirely so the instance never binds a stray 8443.
    const isSecure = /\bSSLEnabled="true"/i.test(tag) || /\bsecure="true"/i.test(tag);
    if (isSecure) {
      if (ports.httpsPort === undefined) {
        return "<!-- BeardCat: HTTPS connector disabled (no HTTPS port configured) -->";
      }
      return setAttr(tag, "port", String(ports.httpsPort));
    }
    // Plain HTTP connector.
    let next = setAttr(tag, "port", String(ports.httpPort));
    if (ports.httpsPort !== undefined) {
      next = setAttr(next, "redirectPort", String(ports.httpsPort));
    }
    return next;
  });

  return out;
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`(\\b${name}=")[^"]*(")`);
  if (re.test(tag)) {
    return tag.replace(re, `$1${value}$2`);
  }
  // Insert before the closing "/>".
  return tag.replace(/\s*\/>$/, ` ${name}="${value}" />`);
}

/** "/" -> ROOT, "/app" -> app, "/a/b" -> a#b */
export function contextFileBase(contextPath: string): string {
  const trimmed = contextPath.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") {
    return "ROOT";
  }
  return trimmed.replace(/\//g, "#");
}

async function writeContextDescriptor(baseDir: string, dep: ResolvedDeployment): Promise<void> {
  const fileBase = contextFileBase(dep.contextPath);
  const target = path.join(baseDir, "conf", "Catalina", "localhost", `${fileBase}.xml`);
  const reloadable = dep.type === "exploded" ? "true" : "false";
  const docBase = dep.docBase.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Context docBase="${docBase}" reloadable="${reloadable}" />
`;
  await writeText(target, xml);
}
