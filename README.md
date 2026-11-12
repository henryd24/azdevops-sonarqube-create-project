# SonarQube Project Creator & Checker

This Azure DevOps extension automates the verification and creation of projects in **SonarQube Server** (self-hosted, including SonarQube Community Build). It pre-configures projects, Quality Gates, New Code definitions, settings and permissions before the analysis begins. It's a helper task, not an official SonarSource extension. For SonarQube Cloud (SonarCloud) use [sonarcloud-create-project](https://github.com/henryd24/azdevops-sonarcloud-create-project).

## 🚀 Why use this task?

  * **Auto-Provisioning:** Creates the project if it doesn't exist.
  * **Standardization:** Applies the Quality Gate, "New Code" definition, quality profiles, settings and permissions.
  * **Smart Verification:** Can be used just to check if a project exists without creating it.
  * **Idempotent:** Reads the current configuration and only applies what differs. Safe to run on every pipeline execution.
  * **Dry run:** Preview the changes without creating or modifying anything.
  * **Resilient:** 30s timeout and retries with exponential backoff on network errors, HTTP 429 and 5xx (honors `Retry-After`).
  * **Secure by default:** TLS certificates are always validated unless you explicitly opt out.

## 🛠️ Recommended Usage

Place this task **before** the `Prepare Analysis Configuration` task from SonarSource.

```yaml
- task: sonarqube-create-project@1
  inputs:
    Sonarqube: 'MySonarQubeConnection'
    serviceKey: 'my-project-key'
    serviceName: 'My Project Name'
    createProject: 'true'
```

### Full example

```yaml
- task: sonarqube-create-project@1
  name: sonarSetup
  inputs:
    Sonarqube: 'MySonarQubeConnection'
    serviceKey: 'my-project-key'          # optional: defaults to the repository name
    serviceName: 'My Project Name'
    createProject: 'true'
    visibility: 'private'
    mainBranch: 'main'
    tags: 'backend,node'
    long_live_branches: '(main|release/.*)'
    sonarQualityGate: 'Company way'
    newCodeDefinitionType: 'NUMBER_OF_DAYS'
    newCodeDefinitionValue: '30'
    additionalSettings: |
      sonar.exclusions=**/test/**,**/*.spec.ts
      sonar.coverage.exclusions=**/migrations/**
    qualityProfiles: |
      ts=Company way
      js=Company way
    permissionTemplate: 'Default template' # applied only when the project is created
    groupPermissions: |
      developers=user,codeviewer
      leads=issueadmin,securityhotspotadmin
    caCertificate: '$(Agent.TempDirectory)/internal-ca.pem' # only for internal/self-signed certificates
    failOnConfigError: true

- script: echo "Project $(sonarSetup.SonarProjectKey) created now: $(sonarSetup.SonarProjectCreated)"
```

-----

## ⚙️ Input Configuration

### Core Settings

| Input Label | Parameter Name | Required | Description |
| :--- | :--- | :---: | :--- |
| **SonarQube Service Connection** | `Sonarqube` | Yes | The Azure DevOps service connection for SonarQube Server (URL + token). |
| **Project keyname** | `serviceKey` | No | Unique identifier for the project (e.g., `front-angular`). If empty, it is derived from the repository name (`Build.Repository.Name`). |
| **Project name** | `serviceName` | No | Human-readable name displayed in SonarQube. Defaults to the key. |
| **Create project** | `createProject` | Yes | `Yes` to create if missing; `No` to only check existence. |

### Project Customization (Visible when Create Project = Yes)

| Input Label | Parameter Name | Required | Description |
| :--- | :--- | :---: | :--- |
| **Main Branch Name** | `mainBranch` | No | On creation it names the main branch. On an existing project the main branch switches to that branch if it was already analyzed, or is renamed otherwise. |
| **Visibility** | `visibility` | Yes | Project visibility used on creation: `private` (default) or `public`. |
| **Enforce visibility on existing projects** | `enforceVisibility` | No | Also update the visibility of projects that already exist. Default `false`. |
| **Tags** | `tags` | No | Comma-separated tags (e.g., `dev,node,aws`). |
| **Branches to keep when inactive (regex)** | `long_live_branches` | No | Comma-separated regular expressions of branches that are never deleted when inactive (e.g., `(main\|release/.*)`). Requires an edition with branch analysis. |
| **Select the quality gate** | `sonarQualityGate` | No | Name of the Quality Gate to assign to the project. |

### New Code Definition

Found under the **Code Definition Options** group.

| Input Label | Parameter Name | Description |
| :--- | :--- | :--- |
| **New Code Definition Type** | `newCodeDefinitionType` | `PREVIOUS_VERSION`, `NUMBER_OF_DAYS` or `REFERENCE_BRANCH`. Leave empty to keep the current definition of the project. |
| **New Code Definition Value** | `newCodeDefinitionValue` | `NUMBER_OF_DAYS`: number between 1 and 90. `REFERENCE_BRANCH`: branch name (empty = main branch). |

### Advanced Configuration

| Input Label | Parameter Name | Description |
| :--- | :--- | :--- |
| **Additional settings** | `additionalSettings` | One `key=value` per line with any project setting (e.g. `sonar.exclusions`, `sonar.cpd.exclusions`). Multi-value settings accept comma-separated values. Explicit inputs take precedence. |
| **Quality profiles** | `qualityProfiles` | One `language=Profile name` per line (language keys: `js`, `ts`, `java`, `cs`, `py`, ...). |
| **Permission template** | `permissionTemplate` | Template applied **only when the project is created** by the task. It replaces the permissions of the project, so it must grant *Administer* to the user of the token. |
| **Group permissions** | `groupPermissions` | One `group=perm1,perm2` per line. Permissions: `admin`, `codeviewer`, `issueadmin`, `securityhotspotadmin`, `scan`, `user`. Only missing permissions are granted. |
| **User permissions** | `userPermissions` | One `login=perm1,perm2` per line. Same permissions as above. |

### Connection Options

| Input Label | Parameter Name | Description |
| :--- | :--- | :--- |
| **CA certificate** | `caCertificate` | PEM file with the certificate authority (or chain) that signed the server certificate. Recommended for internal or self-signed certificates. |
| **Allow insecure SSL** | `allowInsecureSsl` | Skips the certificate validation, only for the requests of this task. Last resort; the task logs a warning. Default `false`. |

### Execution Options

| Input Label | Parameter Name | Description |
| :--- | :--- | :--- |
| **Dry run** | `dryRun` | Logs the changes that would be applied without creating or modifying anything. |
| **Fail on configuration errors** | `failOnConfigError` | Fails the task if any configuration step fails. By default the task ends as *Succeeded with issues*. |

### Output variables

| Name | Description |
| :--- | :--- |
| `SonarProjectKey` | Key of the project (useful when it is derived from the repository name). |
| `SonarProjectUrl` | URL of the project dashboard. |
| `SonarProjectExists` | `true` if the project existed before the task ran. |
| `SonarProjectCreated` | `true` if the project was created by this task. |

-----

## ⬆️ Upgrading from 0.x to 1.0

Existing inputs keep their names, but the behavior changes in these points:

  * **TLS is validated.** Version 0.x disabled certificate validation for the whole process (`NODE_TLS_REJECT_UNAUTHORIZED=0`). If your server uses an internal or self-signed certificate, set `caCertificate` (or the `NODE_EXTRA_CA_CERTS` variable on the agent) or, as a last resort, `allowInsecureSsl: true`.
  * **Default visibility is `private`** (it was `public`). Set `visibility: 'public'` explicitly if you need it.
  * **`long_live_branches` now works.** It used to write `sonar.branch.longLivedBranches.regex`, a setting removed in SonarQube 8.1 that had no effect. It now sets *Branches to keep when inactive* (`sonar.dbcleaner.branchesToKeepWhenInactive`).
  * **New code is only configured when `newCodeDefinitionType` is set.** Version 0.x sent an invalid `REFERENCE_BRANCH` request on every run of an existing project.
  * **The token needs fewer permissions.** The project lookup uses `api/components/show` (Browse) instead of `api/projects/search` (Administer System).
  * **Agents need Node 20 or Node 24.** The legacy `Node` (6) handler was removed.

## 💻 Technical Requirements

  * **SonarQube:** Server 10.2 or later, or Community Build 24.12 or later. Earlier versions lack `mainBranch` on creation (9.8) and `api/project_branches/set_main` (10.2).
  * **Runtime:** Agents running **Node 20** or **Node 24**.
  * **Permissions:** The token of the service connection needs **Create Projects** to create projects and **Administer** on the project to configure it (the creator gets it through the default permission template). **Administer Quality Gates / Quality Profiles** are not required to associate them when the user administers the project.
  * **Editions:** In Community Build a project-level New Code definition is stored on the main branch, and *Branches to keep when inactive* has no effect because there is no branch analysis.

## 🧪 Development

```bash
npm ci                 # installs the packaging tools and the task dependencies
cd src && npm test     # Jest
npm run build          # bundles the task with ncc into dist/task
npm run pack:dev       # development .vsix

# End-to-end test against a disposable SonarQube (never a real server: it changes the admin password)
docker run -d --name sonarqube -p 9000:9000 sonarqube:community
SONAR_URL=http://localhost:9000 node scripts/e2e/e2e.js
```

## 📦 Releases

1. Run **Actions → Release → Run workflow** on the default branch and pick `patch`, `minor` or `major`. The workflow bumps the version in `config/release.json` and `src/task.json`, runs typecheck, tests and packaging, and opens a `chore(release): vX.Y.Z` pull request.
2. Merging it creates the `vX.Y.Z` tag and a GitHub Release with the `.vsix` attached, and then publishes that same `.vsix` to the Visual Studio Marketplace as a private extension (`public: false`).

Marketplace publishing uses [Trusted Publishing](https://learn.microsoft.com/azure/devops/extend/publish/overview#publish-with-oidc-trusted-publishing) (OIDC), so no PAT is stored. It requires a Trusted Publishing policy on the `hendamm` publisher pointing to this repository and the `release.yml` workflow (no environment), and *Settings → Actions → General → Allow GitHub Actions to create and approve pull requests*.

## ⚠️ Disclaimer

This extension is provided "as is" under the Apache 2.0 license, without warranty or support of any kind.
