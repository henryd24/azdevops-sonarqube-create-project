// Bumps the extension version in config/release.json and src/task.json.
// Usage: node .github/scripts/bump-version.mjs <major|minor|patch>
// Prints the new version to stdout. Edits are textual so the files keep their formatting.
import { readFileSync, writeFileSync } from 'node:fs';

const kind = process.argv[2];
if (!['major', 'minor', 'patch'].includes(kind)) {
  console.error('Usage: bump-version.mjs <major|minor|patch>');
  process.exit(1);
}

const releasePath = 'config/release.json';
const taskPath = 'src/task.json';

const release = readFileSync(releasePath, 'utf8');
const current = /"version":\s*"(\d+)\.(\d+)\.(\d+)"/.exec(release);
if (!current) throw new Error(`No semver version found in ${releasePath}`);
let [major, minor, patch] = current.slice(1).map(Number);

const task = readFileSync(taskPath, 'utf8');
const block = /("version":\s*\{\s*"Major":\s*)(\d+)(,\s*"Minor":\s*)(\d+)(,\s*"Patch":\s*)(\d+)/.exec(task);
if (!block) throw new Error(`No version block found in ${taskPath}`);
const taskVersion = [block[2], block[4], block[6]].map(Number);
if (taskVersion.join('.') !== `${major}.${minor}.${patch}`) {
  throw new Error(`Versions differ: ${releasePath}=${major}.${minor}.${patch}, ${taskPath}=${taskVersion.join('.')}`);
}

if (kind === 'major') { major += 1; minor = 0; patch = 0; }
else if (kind === 'minor') { minor += 1; patch = 0; }
else { patch += 1; }

const next = `${major}.${minor}.${patch}`;
writeFileSync(releasePath, release.replace(current[0], `"version": "${next}"`));
writeFileSync(taskPath, task.replace(block[0], `${block[1]}${major}${block[3]}${minor}${block[5]}${patch}`));
console.log(next);
