import { SonarClient, isNotFound } from "./client";
import { Visibility } from "./config";
import { StepContext } from "./step";

export interface SonarProject {
    key: string;
    name: string;
    visibility?: Visibility;
}

export class Projects {
    constructor(private readonly client: SonarClient) { }

    /**
     * Uses api/components/show (requires 'Browse' on the project) instead of api/projects/search,
     * which requires 'Administer System' and whose 'projects' parameter is deprecated since 2026.3.
     */
    async find(projectKey: string): Promise<SonarProject | undefined> {
        try {
            const result = await this.client.get<{ component?: SonarProject }>("/api/components/show", { component: projectKey });
            return result.component?.key === projectKey ? result.component : undefined;
        } catch (err) {
            if (isNotFound(err)) return undefined;
            throw err;
        }
    }

    async create(projectKey: string, name: string, visibility: Visibility, mainBranch?: string): Promise<SonarProject> {
        const result = await this.client.post<{ project?: SonarProject }>("/api/projects/create", {
            project: projectKey,
            name,
            visibility,
            // Supported since SonarQube 9.8.
            mainBranch
        });
        if (!result?.project || result.project.key !== projectKey) {
            throw new Error(`Unexpected response while creating project ${projectKey}: ${JSON.stringify(result)}`);
        }
        return { visibility, ...result.project };
    }

    projectUrl(projectKey: string): string {
        return `${this.client.baseUrl}/dashboard?id=${encodeURIComponent(projectKey)}`;
    }
}

export async function ensureVisibility(ctx: StepContext, current: Visibility | undefined, desired: Visibility): Promise<void> {
    if (current === desired) return;
    await ctx.apply(`Visibility changed from ${current ?? "unknown"} to ${desired}`, () =>
        ctx.client.post("/api/projects/update_visibility", { project: ctx.projectKey, visibility: desired })
    );
}
