# Change Log

## [0.1.2] - Unreleased

- Marketplace icon reworked: the copper BeardGit-style app tile with yellow cat ears and a transparent background, with the Git node removed (that belongs to BeardGit, not this extension).
- Description reworded to emphasize how simple it is to get started.

## [0.1.1] - Unreleased

- New BeardCat branding: marketplace icon (bearded face with sunglasses, git node and yellow cat ears) and a matching monochrome activity-bar icon.
- Hot Code Replace while debugging and an incremental Reload action (recompile changed classes only, no full build).
- Stream every Tomcat log file (localhost, access log, manager, …) to its own Output channel.
- Open the browser only once the app is fully deployed (`Server startup in …`), not when the port merely opens.

## [0.1.0] - Unreleased

Initial release.

- Tomcat Servers view with run configurations and inline run/debug/stop/restart/redeploy actions.
- Multiple Tomcat installation registry (machine-global).
- IntelliJ-style tabbed configuration editor (Server / Deployment / Logs) as a webview.
- WAR and exploded deployments, built from Maven or pointed at an existing artifact.
- Isolated per-configuration `CATALINA_BASE` with patched ports and per-deployment context descriptors.
- Run and Debug (JDWP auto-attach via the Java debugger).
- Open in browser after launch; server output streamed to an Output channel.
