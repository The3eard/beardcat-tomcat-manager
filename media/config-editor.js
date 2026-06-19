(function () {
  const vscode = acquireVsCodeApi();
  let deployments = [];
  let installations = [];

  // ---- tabs -----------------------------------------------------------------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    });
  });

  // ---- helpers --------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const val = (id) => $(id).value;
  const num = (id) => {
    const v = $(id).value.trim();
    return v === "" ? undefined : Number(v);
  };

  function fillInstallations(selectedId) {
    const sel = $("installationId");
    sel.innerHTML = "";
    if (installations.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No installations — add one first";
      sel.appendChild(opt);
      return;
    }
    for (const inst of installations) {
      const opt = document.createElement("option");
      opt.value = inst.id;
      opt.textContent = inst.name + (inst.version ? " (" + inst.version + ")" : "");
      if (inst.id === selectedId) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  // ---- deployments ----------------------------------------------------------
  function renderDeployments() {
    const host = $("deployments");
    host.innerHTML = "";
    deployments.forEach((dep, index) => host.appendChild(deploymentRow(dep, index)));
  }

  function deploymentRow(dep, index) {
    const wrap = document.createElement("div");
    wrap.className = "deployment";

    const remove = document.createElement("button");
    remove.className = "secondary remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      deployments.splice(index, 1);
      renderDeployments();
    });
    wrap.appendChild(remove);

    wrap.appendChild(
      rowSelect("Type", dep.type, ["war", "exploded"], (v) => (deployments[index].type = v))
    );
    wrap.appendChild(
      rowSelect("Source", dep.source, ["maven", "path"], (v) => {
        deployments[index].source = v;
        renderDeployments();
      })
    );

    if (dep.source === "maven") {
      wrap.appendChild(
        rowBrowse("Maven module", dep.mavenModule || "", "mavenModule", index, true,
          (v) => (deployments[index].mavenModule = v),
          "blank = workspace root (folder with pom.xml)")
      );
    } else if (dep.type === "war") {
      wrap.appendChild(
        rowBrowse("WAR file", dep.artifactPath || "", "artifactPath", index, false,
          (v) => (deployments[index].artifactPath = v), "/…/target/app.war")
      );
    } else {
      wrap.appendChild(
        rowBrowse("Exploded dir", dep.artifactPath || "", "artifactPath", index, true,
          (v) => (deployments[index].artifactPath = v), "/…/target/app/")
      );
    }

    wrap.appendChild(
      rowInput("Context", dep.contextPath || "/", (v) => (deployments[index].contextPath = v), "/")
    );
    wrap.appendChild(deploymentHint(dep));
    return wrap;
  }

  function deploymentHint(dep) {
    const hint = document.createElement("div");
    hint.className = "field-hint";
    const ctx = dep.contextPath || "/";
    if (dep.source === "maven") {
      const where = dep.mavenModule ? dep.mavenModule : "the workspace root";
      hint.textContent =
        "→ Builds " + where + " with Maven, then serves the resulting " + dep.type + " at context “" + ctx + "”.";
    } else {
      hint.textContent =
        "→ Serves the " + dep.type + " at " + (dep.artifactPath || "(set a path)") + " at context “" + ctx + "”.";
    }
    return hint;
  }

  function rowSelect(label, value, options, onChange) {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(labelEl(label));
    const sel = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o;
      opt.textContent = o;
      if (o === value) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => onChange(sel.value));
    row.appendChild(sel);
    return row;
  }

  function rowInput(label, value, onChange, placeholder) {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(labelEl(label));
    const input = document.createElement("input");
    input.type = "text";
    input.className = "grow";
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(input);
    return row;
  }

  function rowBrowse(label, value, field, index, folders, onChange, placeholder) {
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(labelEl(label));
    const span = document.createElement("span");
    span.className = "grow browse";
    const input = document.createElement("input");
    input.type = "text";
    input.className = "grow";
    input.value = value;
    if (placeholder) input.placeholder = placeholder;
    input.dataset.field = field;
    input.dataset.index = String(index);
    input.addEventListener("input", () => onChange(input.value));
    const btn = document.createElement("button");
    btn.className = "secondary browse-btn";
    btn.textContent = "…";
    btn.addEventListener("click", () =>
      vscode.postMessage({ type: "browse", field, index, folders })
    );
    span.appendChild(input);
    span.appendChild(btn);
    row.appendChild(span);
    return row;
  }

  function labelEl(text) {
    const l = document.createElement("label");
    l.textContent = text;
    return l;
  }

  $("addDeployment").addEventListener("click", () => {
    deployments.push({ type: "war", source: "maven", contextPath: "/" });
    renderDeployments();
  });

  // ---- top-level browse (JRE) ----------------------------------------------
  document.querySelectorAll(".browse-btn[data-field]").forEach((btn) => {
    btn.addEventListener("click", () =>
      vscode.postMessage({ type: "browse", field: btn.dataset.field, folders: btn.dataset.folders === "true" })
    );
  });

  // ---- gather + save --------------------------------------------------------
  function gather() {
    return {
      name: val("name") || "Tomcat",
      installationId: val("installationId"),
      jrePath: val("jrePath"),
      vmOptions: val("vmOptions"),
      httpPort: num("httpPort") ?? 8080,
      httpsPort: num("httpsPort"),
      ajpPort: num("ajpPort"),
      deployments: deployments,
      openBrowser: $("openBrowser").checked,
      browserUrl: val("browserUrl"),
      onUpdate: val("onUpdate"),
      buildBeforeLaunch: $("buildBeforeLaunch").checked,
      mvnGoals: val("mvnGoals")
    };
  }

  $("apply").addEventListener("click", () => vscode.postMessage({ type: "save", config: gather(), close: false }));
  $("ok").addEventListener("click", () => vscode.postMessage({ type: "save", config: gather(), close: true }));
  $("cancel").addEventListener("click", () => vscode.postMessage({ type: "cancel" }));

  // ---- init -----------------------------------------------------------------
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (msg.type === "init") {
      installations = msg.installations || [];
      const c = msg.config;
      $("name").value = c.name || "";
      fillInstallations(c.installationId);
      $("jrePath").value = c.jrePath || "";
      $("vmOptions").value = c.vmOptions || "";
      $("httpPort").value = c.httpPort ?? 8080;
      $("httpsPort").value = c.httpsPort ?? "";
      $("ajpPort").value = c.ajpPort ?? "";
      $("openBrowser").checked = !!c.openBrowser;
      $("browserUrl").value = c.browserUrl || "";
      $("onUpdate").value = c.onUpdate || "restart";
      $("buildBeforeLaunch").checked = c.buildBeforeLaunch !== false;
      $("mvnGoals").value = c.mvnGoals || "";
      deployments = (c.deployments || []).map((d) => Object.assign({}, d));
      renderDeployments();
    } else if (msg.type === "browseResult" && msg.path) {
      if (msg.index === undefined || msg.index === null) {
        const el = document.querySelector('[data-field="' + msg.field + '"]:not([data-index])') || $(msg.field);
        if (el) el.value = msg.path;
      } else {
        const dep = deployments[msg.index];
        if (dep) {
          dep[msg.field] = msg.path;
          renderDeployments();
        }
      }
    }
  });

  vscode.postMessage({ type: "ready" });
})();
