import { StepContext } from "./step";

interface QualityProfile {
    key: string;
    name: string;
    language: string;
}

async function projectProfiles(ctx: StepContext): Promise<QualityProfile[]> {
    try {
        const result = await ctx.client.get<{ profiles?: QualityProfile[] }>("/api/qualityprofiles/search", {
            project: ctx.projectKey
        });
        return result.profiles ?? [];
    } catch {
        return [];
    }
}

/**
 * @param desired map of language key (e.g. js, ts, java, cs, py) to quality profile name.
 */
export async function ensureQualityProfiles(ctx: StepContext, desired: Map<string, string>): Promise<void> {
    const current = await projectProfiles(ctx);
    for (const [language, profileName] of desired) {
        const assigned = current.find(p => p.language === language);
        if (assigned?.name === profileName) continue;
        await ctx.apply(`Quality profile for '${language}' set to '${profileName}'`, () =>
            ctx.client.post("/api/qualityprofiles/add_project", {
                project: ctx.projectKey,
                language,
                qualityProfile: profileName
            })
        );
    }
}
