// Runs the rules of scripts/workflow-lint.js on the repository's workflows, composite actions and Azure pipeline.
// Usage: node scripts/check-workflows.js   (exits with code 1 when there are problems)
const fs = require("node:fs");
const path = require("node:path");
const yaml = require("js-yaml");
const { lintAction, lintAzurePipeline, lintWorkflow } = require("./workflow-lint");

// Options of this repository (see lintAzurePipeline).
const AZURE_OPTIONS = { allowPr: false };

const root = path.join(__dirname, "..");
const load = (file) => yaml.load(fs.readFileSync(path.join(root, file), "utf8"));
const yamlFiles = (dir) =>
  fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)).filter((f) => /\.ya?ml$/.test(f)) : [];
const problems = [];

for (const name of yamlFiles(".github/workflows")) {
  problems.push(...lintWorkflow(load(`.github/workflows/${name}`), `.github/workflows/${name}`));
}
const actions = path.join(root, ".github", "actions");
if (fs.existsSync(actions)) {
  for (const name of fs.readdirSync(actions)) {
    for (const file of ["action.yml", "action.yaml"].map((f) => `.github/actions/${name}/${f}`)) {
      if (fs.existsSync(path.join(root, file))) problems.push(...lintAction(load(file), file));
    }
  }
}
if (fs.existsSync(path.join(root, "azure-pipelines.yml"))) {
  problems.push(...lintAzurePipeline(load("azure-pipelines.yml"), "azure-pipelines.yml", AZURE_OPTIONS));
}

if (problems.length > 0) {
  console.error(`Workflow security check failed (${problems.length}):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("Workflow security check passed");
