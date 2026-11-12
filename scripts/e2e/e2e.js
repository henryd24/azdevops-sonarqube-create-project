// End-to-end test of the bundled task (dist/task) against a real SonarQube server, normally a
// disposable `sonarqube:community` container. It prepares the server (admin password, token, group,
// quality gate, permission template), runs the task in several scenarios through run-task.js and
// verifies the result with the Web API, independently of the task code.
//
// Usage: SONAR_URL=http://localhost:9000 node scripts/e2e/e2e.js
// Optional: SONAR_ADMIN_PASSWORD (initial admin password, default "admin").
// Never point it at a real server: it changes the admin password and creates projects.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const baseUrl = (process.env.SONAR_URL || "").replace(/\/+$/, "");
if (!baseUrl) {
  console.error("SONAR_URL must be set.");
  process.exit(2);
}
const runTask = path.join(__dirname, "run-task.js");
let authorization;
let token;
let lastOutput = "";

async function api(method, apiPath, params = {}, auth = authorization) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    (Array.isArray(value) ? value : [value]).forEach((v) => search.append(key, v));
  }
  const query = search.toString();
  const response = await fetch(`${baseUrl}${apiPath}${method === "GET" && query ? `?${query}` : ""}`, {
    method,
    headers: {
      Authorization: auth,
      Accept: "application/json",
      ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body: method === "POST" ? query : undefined,
    signal: AbortSignal.timeout(30000)
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${apiPath} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function basic(user, password) {
  return "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
}

async function setup() {
  const initial = process.env.SONAR_ADMIN_PASSWORD || "admin";
  const password = process.env.SONAR_E2E_PASSWORD || `E2e-${Date.now()}-Pass!`;
  await api("POST", "/api/users/change_password", { login: "admin", previousPassword: initial, password }, basic("admin", initial));
  authorization = basic("admin", password);
  token = (await api("POST", "/api/user_tokens/generate", { name: `e2e-${Date.now()}` })).token;
  authorization = basic(token, "");
  await api("POST", "/api/user_groups/create", { name: "devs" });
  await api("POST", "/api/qualitygates/copy", { sourceName: "Sonar way", name: "Company Way" });
  await api("POST", "/api/permissions/create_template", { name: "E2E template" });
  // The template replaces the project permissions: it must keep 'Administer' for the token's user.
  for (const permission of ["admin", "user", "codeviewer"]) {
    await api("POST", "/api/permissions/add_group_to_template", { templateName: "E2E template", groupName: "sonar-administrators", permission });
  }
}

function task(inputs, { expectFailure = false, env = {} } = {}) {
  const args = [runTask, ...(expectFailure ? ["--expect-failure"] : []), ...Object.entries(inputs).map(([k, v]) => `${k}=${v}`)];
  const result = spawnSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, SONAR_URL: baseUrl, SONAR_TOKEN: token, ...env }
  });
  const output = `${result.stdout}${result.stderr}`;
  lastOutput = output;
  if (result.status !== 0) {
    console.log(output);
    throw new Error(`The task ${expectFailure ? "did not fail as expected" : "failed"}.`);
  }
  return output;
}

function assert(condition, message) {
  if (!condition) {
    console.log(`Output of the last task run:\n${lastOutput}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ok - ${message}`);
}

async function newCodeOf(project, mainBranch) {
  const atProject = await api("GET", "/api/new_code_periods/show", { project });
  return atProject.inherited ? api("GET", "/api/new_code_periods/show", { project, branch: mainBranch }) : atProject;
}

const KEY = "e2e-project";
const full = {
  serviceKey: KEY,
  serviceName: "E2E & Project",
  visibility: "private",
  mainBranch: "trunk",
  tags: "Dev,node",
  sonarQualityGate: "company way",
  newCodeDefinitionType: "NUMBER_OF_DAYS",
  newCodeDefinitionValue: "30",
  long_live_branches: "(main|release/.*)",
  additionalSettings: "sonar.exclusions=**/test/**,**/*.spec.ts\\nsonar.cpd.exclusions=**/generated/**",
  qualityProfiles: "js=Sonar way extended",
  permissionTemplate: "E2E template",
  groupPermissions: "devs=user,issueadmin",
  userPermissions: "admin=codeviewer",
  failOnConfigError: "true"
};

async function scenarios() {
  console.log("Scenario: check only, missing project");
  let out = task({ serviceKey: KEY, createProject: "false" }, { expectFailure: true });
  assert(out.includes(`The ${KEY} project does NOT exist.`), "fails when the project does not exist");

  console.log("Scenario: dry run on a missing project");
  out = task({ ...full, dryRun: "true" });
  assert(out.includes("[dry-run] Project e2e-project would be created"), "logs the planned creation");
  assert((await api("GET", "/api/projects/search", { q: KEY })).components.length === 0, "the project was not created");

  console.log("Scenario: create with the full configuration");
  out = task(full);
  assert(/variable=SonarProjectCreated;isOutput=true;[^\]]*\]true/.test(out), "sets SonarProjectCreated=true");
  const component = (await api("GET", "/api/components/show", { component: KEY })).component;
  assert(component.name === "E2E & Project", "keeps special characters in the name");
  assert(component.visibility === "private", "visibility private");
  assert([...component.tags].sort().join(",") === "dev,node", "tags dev,node");
  const branches = (await api("GET", "/api/project_branches/list", { project: KEY })).branches;
  assert(branches.find((b) => b.isMain).name === "trunk", "main branch trunk");
  const gate = (await api("GET", "/api/qualitygates/get_by_project", { project: KEY })).qualityGate;
  assert(gate.name === "Company Way" && !gate.default, "quality gate Company Way");
  // Community Build stores the project definition on the main branch; commercial editions on the project.
  const newCode = await newCodeOf(KEY, "trunk");
  assert(newCode.type === "NUMBER_OF_DAYS" && newCode.value === "30", `new code NUMBER_OF_DAYS 30 (${JSON.stringify(newCode)})`);
  const settings = (await api("GET", "/api/settings/values", {
    component: KEY, keys: "sonar.exclusions,sonar.cpd.exclusions,sonar.dbcleaner.branchesToKeepWhenInactive"
  })).settings;
  const setting = (key) => settings.find((s) => s.key === key) || {};
  assert((setting("sonar.exclusions").values || []).join("|") === "**/test/**|**/*.spec.ts", "multi-value sonar.exclusions");
  assert((setting("sonar.cpd.exclusions").values || []).join("|") === "**/generated/**", "sonar.cpd.exclusions");
  // Editions without branch analysis do not define the key and answer it as a single value.
  const keep = setting("sonar.dbcleaner.branchesToKeepWhenInactive");
  assert((keep.values ? keep.values.join(",") : keep.value) === "(main|release/.*)", "branches to keep when inactive");
  const groups = (await api("GET", "/api/permissions/groups", { projectKey: KEY, q: "devs" })).groups;
  assert(["user", "issueadmin"].every((p) => groups.find((g) => g.name === "devs").permissions.includes(p)), "group permissions for devs");
  const users = (await api("GET", "/api/permissions/users", { projectKey: KEY, q: "admin" })).users;
  assert(users.find((u) => u.login === "admin").permissions.includes("codeviewer"), "user permission for admin");

  console.log("Scenario: second run is idempotent");
  out = task(full);
  const changes = out.split(/\r?\n/).filter((l) => /^\[[^\]]+\] (?!Already up to date)/.test(l));
  assert(changes.length === 0, `no changes on the second run${changes.length ? `: ${changes.join(" / ")}` : ""}`);
  assert(/variable=SonarProjectExists;isOutput=true;[^\]]*\]true/.test(out), "sets SonarProjectExists=true");

  console.log("Scenario: update an existing project");
  task({ serviceKey: KEY, mainBranch: "main", newCodeDefinitionType: "REFERENCE_BRANCH", visibility: "public", enforceVisibility: "true", failOnConfigError: "true" });
  assert((await api("GET", "/api/project_branches/list", { project: KEY })).branches.find((b) => b.isMain).name === "main", "main branch renamed to main");
  const reference = await newCodeOf(KEY, "main");
  assert(reference.type === "REFERENCE_BRANCH" && reference.value === "main", `new code REFERENCE_BRANCH defaults to the main branch (${JSON.stringify(reference)})`);
  assert((await api("GET", "/api/components/show", { component: KEY })).component.visibility === "public", "visibility enforced to public");

  console.log("Scenario: dry run on an existing project");
  out = task({ serviceKey: KEY, tags: "other", dryRun: "true" });
  assert(out.includes("[dry-run] Tags set to: other"), "logs the planned change");
  assert([...(await api("GET", "/api/components/show", { component: KEY })).component.tags].sort().join(",") === "dev,node", "tags unchanged");

  console.log("Scenario: invalid token");
  out = task({ serviceKey: KEY }, { expectFailure: true, env: { SONAR_TOKEN: "invalid" } });
  assert(out.includes("Check the token"), "explains the authentication error");

  await tlsScenarios();
}

/** HTTPS reverse proxy with a self-signed certificate in front of the server. */
async function tlsScenarios() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sonar-e2e-tls-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  const openssl = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert,
    "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { encoding: "utf8" });
  if (openssl.status !== 0) {
    console.log("Skipping TLS scenarios: openssl is not available.");
    return;
  }
  const target = new URL(baseUrl);
  const server = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
    const proxied = require("node:http").request(
      { host: target.hostname, port: target.port || 80, path: req.url, method: req.method, headers: { ...req.headers, host: target.host } },
      (upstream) => { res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res); }
    );
    proxied.on("error", () => { res.writeHead(502); res.end(); });
    req.pipe(proxied);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpsUrl = `https://localhost:${server.address().port}`;
  const env = { SONAR_URL: httpsUrl };
  // The proxy runs in this process, so the task is spawned asynchronously (spawnSync would block it).
  const runAsync = (inputs, expectFailure) => new Promise((resolve, reject) => {
    const args = [runTask, ...(expectFailure ? ["--expect-failure"] : []), ...Object.entries(inputs).map(([k, v]) => `${k}=${v}`)];
    const child = require("node:child_process").spawn(process.execPath, args, {
      env: { ...process.env, SONAR_TOKEN: token, ...env, NODE_EXTRA_CA_CERTS: "" }
    });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(`TLS scenario failed:\n${output}`)));
  });
  try {
    console.log("Scenario: TLS with a self-signed certificate");
    let out = await runAsync({ serviceKey: KEY, createProject: "false" }, true);
    assert(out.includes("TLS error"), "fails by default with a TLS hint");
    out = await runAsync({ serviceKey: KEY, createProject: "false", caCertificate: cert }, false);
    assert(out.includes(`Project ${KEY} exists.`), "works with the CA certificate");
    out = await runAsync({ serviceKey: KEY, createProject: "false", allowInsecureSsl: "true" }, false);
    assert(out.includes("TLS certificate validation is disabled"), "works with allowInsecureSsl and warns");
  } finally {
    server.close();
  }
}

(async () => {
  await setup();
  await scenarios();
  console.log("All e2e scenarios passed.");
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
