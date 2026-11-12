// Security rules for this repository's GitHub Actions workflows and Azure pipeline.
// They run in CI (scripts/check-workflows.js) so they do not depend on anyone remembering them.
// This file is shared by all the extensions: keep it identical across repositories.
//
// Threat model: anyone can fork the repository and open a pull request. Its code (package.json, npm scripts and
// the workflows of the PR itself) runs on our runners, so no flow triggered by a PR may get secrets or write
// permissions, and no data controlled by the PR author may be interpolated into a shell.

const SAFE_RUN_EXPRESSION = /^(matrix|runner|strategy)\.[\w.-]+$/;
const FORBIDDEN_TRIGGERS = ["pull_request_target", "workflow_run"];
const PINNED = /@[0-9a-f]{40}$/;

function triggersOf(doc) {
  // js-yaml 4 keeps `on` as a string, but the YAML 1.1 boolean key is accepted just in case.
  const on = doc.on ?? doc[true];
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return on ? Object.keys(on) : [];
}

// Write scopes a pull_request job may hold: CodeQL needs `security-events: write` to upload its results, and
// GitHub gives fork pull requests a read-only token whatever the workflow asks for.
const PR_ALLOWED_WRITE = new Set(["security-events"]);

function hasWrite(permissions, allowed = new Set()) {
  if (permissions === undefined) return false;
  if (typeof permissions === "string") return permissions === "write-all";
  return Object.entries(permissions).some(([scope, v]) => v === "write" && !allowed.has(scope));
}

function lintSteps(steps, where, fail, { fromPullRequest = false } = {}) {
  (steps ?? []).forEach((step, i) => {
    const label = `${where}, step ${i + 1}${step.name ? ` ('${step.name}')` : ""}`;
    if (step.uses) {
      // Local actions (./.github/actions/...) are reviewed with the repository; every other action is pinned.
      if (!step.uses.startsWith("./") && !PINNED.test(step.uses)) {
        fail(`${label} uses '${step.uses}': actions must be pinned to a full commit SHA (a tag can be moved)`);
      }
      if (step.uses.startsWith("actions/checkout") && step.with?.["persist-credentials"] !== false) {
        fail(`${label} checks out without 'persist-credentials: false' (the token would stay in .git/config for later steps)`);
      }
    }
    if (typeof step.run === "string") {
      for (const match of step.run.matchAll(/\$\{\{([^}]*)\}\}/g)) {
        const expression = match[1].trim();
        if (!SAFE_RUN_EXPRESSION.test(expression)) {
          fail(`${label} interpolates '\${{ ${expression} }}' inside a run script: pass it through 'env:' and use a shell variable (script injection)`);
        }
      }
    }
    if (fromPullRequest && JSON.stringify(step).includes("secrets.")) fail(`${label} references secrets in a workflow triggered by pull_request`);
  });
}

/** Returns the list of problems of a workflow (empty = it follows the rules). */
function lintWorkflow(doc, file) {
  const problems = [];
  const fail = (message) => problems.push(`${file}: ${message}`);
  const triggers = triggersOf(doc);
  const fromPullRequest = triggers.includes("pull_request");

  for (const t of FORBIDDEN_TRIGGERS) {
    if (triggers.includes(t)) fail(`uses the '${t}' trigger, which runs with a privileged token and secrets on untrusted input`);
  }

  if (doc.permissions === undefined) fail("has no top-level 'permissions' (the default token is too broad)");
  else if (hasWrite(doc.permissions)) fail("grants write permissions at the top level: declare them on the job that needs them");

  if (fromPullRequest && JSON.stringify(doc).includes("secrets.")) fail("is triggered by pull_request but references secrets");

  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    const where = `job '${jobName}'`;
    if (typeof job["timeout-minutes"] !== "number") fail(`${where} has no 'timeout-minutes'`);
    if (fromPullRequest && hasWrite(job.permissions, PR_ALLOWED_WRITE)) fail(`${where} has write permissions in a workflow triggered by pull_request`);
    lintSteps(job.steps, where, fail);
  }
  return problems;
}

/** Rules for composite actions (.github/actions/<name>/action.yml): same step rules as the workflows. */
function lintAction(doc, file) {
  const problems = [];
  const fail = (message) => problems.push(`${file}: ${message}`);
  if (doc.runs?.using === "composite") lintSteps(doc.runs.steps, "composite action", fail);
  if (JSON.stringify(doc).includes("secrets.")) fail("references secrets: pass them as inputs from the workflow that needs them");
  return problems;
}

function* azureConditions(node) {
  if (Array.isArray(node)) for (const item of node) yield* azureConditions(item);
  else if (node && typeof node === "object") {
    if (typeof node.condition === "string") yield node;
    for (const value of Object.values(node)) yield* azureConditions(value);
  }
}

/**
 * Rules for the Azure pipeline (azure-pipelines.yml).
 * `allowPr`: the repository builds pull requests in Azure on purpose (required status check). Then the pipeline
 * must not use secrets, and the Azure settings must keep "Make secrets available to builds of forks" off.
 */
function lintAzurePipeline(doc, file, { allowPr = false } = {}) {
  const problems = [];
  const fail = (message) => problems.push(`${file}: ${message}`);
  if (!allowPr && doc.pr !== "none") {
    fail("must declare 'pr: none': an Azure PR build runs the YAML of the pull request itself, so a fork could change what runs");
  }
  for (const node of azureConditions(doc)) {
    // A custom condition replaces the default succeeded(): without it the step runs even if a previous one failed.
    if (!/succeeded|always\(\)|failed\(\)|canceled\(\)/.test(node.condition)) {
      fail(`condition '${node.condition}' replaces the default succeeded(): use and(succeeded(), ...)`);
    }
  }
  return problems;
}

module.exports = { lintWorkflow, lintAction, lintAzurePipeline };
