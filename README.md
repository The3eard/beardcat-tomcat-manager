# BeardCat — Tomcat Manager

**The easy way to run and debug local Apache Tomcat from VS Code.** Add a Tomcat install, pick your WAR or exploded deployment, and hit **Run** or **Debug** — no fiddly setup. It works the way IntelliJ's Tomcat plugin does, but stays simple enough to get going in a couple of clicks: everything lives in one dedicated **Tomcat Servers** view, and each configuration runs in its own isolated `CATALINA_BASE` so you never touch your shared install.

## Why another Tomcat extension?

Each run configuration launches against its **own generated `CATALINA_BASE`** (isolated `conf/`, `webapps/`, `logs/`, `work/`, `temp/`). Your real Tomcat install (`CATALINA_HOME`) is never modified, so multiple servers and configurations coexist cleanly — the same approach IntelliJ uses, and the thing other VS Code Tomcat extensions get wrong.

## Features

- **Multiple Tomcat installations** — register any number of `CATALINA_HOME` directories, reuse them across configurations.
- **IntelliJ-style configuration editor** — a tabbed form (Server / Deployment / Logs) for ports, VM options, JRE, browser launch and deployments.
- **WAR and exploded deployments** — built from a Maven module (`mvn package`) or pointed at an existing artifact. Exploded deployments use a reloadable context for fast iteration.
- **Run & Debug** — Debug starts Tomcat with JDWP and auto-attaches VS Code's Java debugger.
- **Hot reload** — the *Reload* action recompiles only changed classes (`mvn compile war:exploded`, no clean/package) and re-syncs the exploded webapp; Tomcat's reloadable context picks it up without a restart.
- **Hot Code Replace** — while debugging, method-body edits are pushed straight into the running JVM over JDWP (no rebuild/redeploy). Structural changes fall back to *Reload* or *Restart*.
- **Isolated ports** — HTTP / HTTPS / AJP / shutdown / debug ports are patched per configuration and auto-deconflicted.
- **Open in browser** after launch.

## Requirements

- A local Apache Tomcat installation (Tomcat 9 / 10 / 11).
- A JDK (configured via the configuration's JRE field, the `beardcat.defaultJrePath` setting, or `JAVA_HOME`).
- **Maven** on `PATH` or set via `beardcat.mvnPath` (only needed for Maven-sourced deployments).
- For **debugging**: the [Debugger for Java](https://marketplace.visualstudio.com/items?itemName=vscjava.vscode-java-debug) extension (offered for install on first use).

## Getting started

1. Open the **Tomcat Servers** view in the Activity Bar.
2. **Add Tomcat Installation** → pick your `CATALINA_HOME`.
3. **Add Configuration** → set the deployment (module, type, context path) and ports in the editor.
4. Hit **Run** ▶ or **Debug** 🐞 on the configuration.

## Settings

| Setting | Default | Description |
|---|---|---|
| `beardcat.mvnPath` | `mvn` on PATH | Path to the Maven executable. |
| `beardcat.defaultJrePath` | `JAVA_HOME` | Default `JAVA_HOME` used when a configuration doesn't override it. |
| `beardcat.shutdownPortBase` | `8005` | Base shutdown port; each running config derives a unique one. |
| `beardcat.debugPortBase` | `8000` | Base JDWP debug port; each debugged config derives a unique one. |

## Configuration storage

Run configurations are stored in `.vscode/beardcat-tomcat.json` (shareable, "store as project file"). Installations are stored in machine-global state because their paths are machine-specific.

## Known limitations (v0.1)

- HTTPS requires an SSL connector already configured in your Tomcat `server.xml`; the extension patches the port but does not generate certificates.
- Hot reload requires an **exploded** Maven deployment (WAR/path deployments fall back to Restart). Context reload happens on Tomcat's background cycle (≈10 s). Hot Code Replace requires an active debug session and the Java language server (`redhat.java`).
- Per-file log tailing (the Logs tab) is a placeholder; server output streams to the `Tomcat: <name>` Output channel.

## License

MIT
