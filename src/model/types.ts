/** A registered Tomcat installation (CATALINA_HOME). Reusable across configurations. */
export interface TomcatInstallation {
  id: string;
  name: string;
  /** Absolute path to CATALINA_HOME. */
  path: string;
  /** Detected Tomcat version, e.g. "10.1.52". */
  version?: string;
}

export type DeploymentType = "war" | "exploded";
export type DeploymentSource = "maven" | "path";

/** A single artifact deployed by a configuration. */
export interface Deployment {
  type: DeploymentType;
  source: DeploymentSource;
  /** For source === "maven": directory containing the module's pom.xml. Defaults to the workspace root. */
  mavenModule?: string;
  /** For source === "path": absolute path to the .war (war) or exploded directory (exploded). */
  artifactPath?: string;
  /** Context path, e.g. "/" or "/app". */
  contextPath: string;
}

/** What happens when the user triggers "Redeploy" while the server is running. */
export type OnUpdateAction = "restart" | "redeploy";

/** A Tomcat run/debug configuration (the IntelliJ "Run Configuration" equivalent). */
export interface TomcatRunConfig {
  id: string;
  name: string;
  /** Id of the TomcatInstallation this config runs against. */
  installationId: string;
  /** JAVA_HOME override; empty/undefined falls back to the global default / JAVA_HOME. */
  jrePath?: string;
  vmOptions: string;
  httpPort: number;
  httpsPort?: number;
  ajpPort?: number;
  deployments: Deployment[];
  openBrowser: boolean;
  browserUrl?: string;
  onUpdate: OnUpdateAction;
  /** Run the Maven build before launching / redeploying. */
  buildBeforeLaunch: boolean;
  /** Maven goals override for war builds. Defaults handled per deployment type. */
  mvnGoals?: string;
}

export type ServerState = "stopped" | "starting" | "running" | "debugging" | "stopping";

export function defaultConfig(id: string, installationId: string): TomcatRunConfig {
  return {
    id,
    name: "Tomcat",
    installationId,
    jrePath: "",
    vmOptions: "",
    httpPort: 8080,
    httpsPort: undefined,
    ajpPort: undefined,
    deployments: [],
    openBrowser: true,
    browserUrl: "http://localhost:8080/",
    onUpdate: "restart",
    buildBeforeLaunch: true,
    mvnGoals: ""
  };
}
