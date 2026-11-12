import * as tl from "azure-pipelines-task-lib";
import { group, info, endGroup, success, warn } from "./logger";
import { SonarClient, isAuthError } from "./client";
import { readConfig, TaskConfig } from "./config";
import { Projects, SonarProject, ensureVisibility } from "./projects";
import { ensureTags } from "./tags";
import { ensureQualityGate } from "./quality_gate";
import { ensureQualityProfiles } from "./quality_profiles";
import { buildDesiredSettings, ensureMainBranch, ensureNewCodeDefinition, ensureSettings } from "./settings";
import { applyPermissionTemplate, ensurePermissions } from "./permissions";
import { Step, StepOutcome, runStep } from "./step";

function setOutput(name: string, value: string) {
    tl.setVariable(name, value);
    tl.setVariable(name, value, false, true);
}

function buildSteps(config: TaskConfig, project: SonarProject, createdNow: boolean): [string, Step][] {
    const steps: [string, Step][] = [];
    if (config.enforceVisibility && !createdNow) {
        steps.push(["Visibility", ctx => ensureVisibility(ctx, project.visibility, config.visibility)]);
    }
    if (config.tags.length > 0) {
        steps.push(["Tags", ctx => ensureTags(ctx, config.tags)]);
    }
    if (config.qualityGate) {
        steps.push(["Quality gate", ctx => ensureQualityGate(ctx, config.qualityGate!)]);
    }
    if (config.qualityProfiles.size > 0) {
        steps.push(["Quality profiles", ctx => ensureQualityProfiles(ctx, config.qualityProfiles)]);
    }
    const settings = buildDesiredSettings(config.additionalSettings, config.branchesToKeepWhenInactive);
    if (settings.size > 0) {
        steps.push(["Settings", ctx => ensureSettings(ctx, settings)]);
    }
    if (config.newCodeDefinition) {
        steps.push(["New code", ctx => ensureNewCodeDefinition(ctx, config.newCodeDefinition!, config.mainBranch)]);
    }
    // On creation the main branch is already set by api/projects/create.
    if (config.mainBranch && !createdNow) {
        steps.push(["Main branch", ctx => ensureMainBranch(ctx, config.mainBranch!)]);
    }
    if (config.groupPermissions.length > 0 || config.userPermissions.length > 0) {
        steps.push(["Permissions", async ctx => {
            // The configured visibility is applied before permissions only on creation or when enforced.
            const visibility = createdNow || config.enforceVisibility ? config.visibility : project.visibility;
            await ensurePermissions(ctx, "group", config.groupPermissions, visibility);
            await ensurePermissions(ctx, "user", config.userPermissions, visibility);
        }]);
    }
    return steps;
}

function report(outcomes: StepOutcome[]): string[] {
    const failures: string[] = [];
    for (const outcome of outcomes) {
        outcome.notes.forEach(note => info(`[${outcome.name}] ${note}`));
        if (outcome.changes.length === 0 && !outcome.error) {
            info(`[${outcome.name}] Already up to date.`);
        }
        outcome.changes.forEach(change => success(`[${outcome.name}] ${change}`));
        if (outcome.error) {
            warn(`[${outcome.name}] ${outcome.error}`);
            failures.push(`${outcome.name}: ${outcome.error}`);
        }
    }
    return failures;
}

export async function run(): Promise<void> {
    try {
        const config = readConfig();
        if (config.tls.insecure) {
            warn("TLS certificate validation is disabled for the SonarQube requests ('Allow insecure SSL'). Prefer 'CA certificate'.");
        }
        const client = new SonarClient(config.baseUrl, config.token, { tls: config.tls });
        const projects = new Projects(client);
        const { projectKey } = config;

        setOutput("SonarProjectKey", projectKey);
        setOutput("SonarProjectUrl", projects.projectUrl(projectKey));

        let project = await projects.find(projectKey);
        setOutput("SonarProjectExists", String(!!project));
        setOutput("SonarProjectCreated", "false");
        info(project ? `Project ${projectKey} exists.` : `Project ${projectKey} does not exist.`);

        if (!config.createProject) {
            if (!project) tl.setResult(tl.TaskResult.Failed, `The ${projectKey} project does NOT exist.`);
            return;
        }

        group(`Project configuration for ${projectKey}${config.dryRun ? " (dry run)" : ""}`);
        try {
            let createdNow = false;
            if (!project) {
                if (config.dryRun) {
                    info(`[dry-run] Project ${projectKey} would be created with name '${config.projectName}' and visibility ${config.visibility}.`);
                    info("[dry-run] The rest of the configuration will be applied after the project is created.");
                    return;
                }
                project = await projects.create(projectKey, config.projectName, config.visibility, config.mainBranch);
                createdNow = true;
                setOutput("SonarProjectCreated", "true");
                success(`The project ${projectKey} was successfully created with name ${config.projectName}.`);
            }

            const stepClient = createdNow ? client.withNotFoundRetries() : client;
            const outcomes: StepOutcome[] = [];
            // The template replaces every permission of the project (including the token's), so it runs
            // alone before the other steps; running it concurrently made them fail with 403.
            if (config.permissionTemplate && createdNow) {
                const template = await runStep("Permission template", ctx => applyPermissionTemplate(ctx, config.permissionTemplate!),
                    stepClient, projectKey, config.dryRun);
                outcomes.push(template);
            }
            outcomes.push(...await Promise.all(
                buildSteps(config, project, createdNow).map(([name, step]) =>
                    runStep(name, step, stepClient, projectKey, config.dryRun))
            ));
            const failures = report(outcomes);
            if (failures.some(f => f.includes("HTTP 403")) && config.permissionTemplate && createdNow) {
                warn(`Some steps were denied after applying the permission template '${config.permissionTemplate}'. Make sure the template grants 'Administer' on the project to the user of the token (directly or through a group).`);
            }

            if (failures.length > 0) {
                const message = `${failures.length} configuration step(s) failed: ${failures.join(" | ")}`;
                tl.setResult(config.failOnConfigError ? tl.TaskResult.Failed : tl.TaskResult.SucceededWithIssues, message);
            }
        } finally {
            endGroup();
        }
    } catch (err) {
        const message = isAuthError(err)
            ? `Authentication/authorization error against SonarQube: ${(err as Error).message.replace(/\.+$/, "")}. Check the token of the service connection and its permissions (Browse, Administer on the project, Create Projects).`
            : (err as Error).message;
        tl.setResult(tl.TaskResult.Failed, message);
    }
}
