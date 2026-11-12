import { StepContext } from "./step";

async function currentTags(ctx: StepContext): Promise<string[] | undefined> {
    try {
        const result = await ctx.client.get<{ component?: { tags?: string[] } }>("/api/components/show", {
            component: ctx.projectKey
        });
        return result.component?.tags;
    } catch {
        // If the current tags cannot be read, fall back to always setting them.
        return undefined;
    }
}

function sameTags(a: string[], b: string[]): boolean {
    return a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
}

export async function ensureTags(ctx: StepContext, desired: string[]): Promise<void> {
    const current = await currentTags(ctx);
    if (current && sameTags(current, desired)) return;
    await ctx.apply(`Tags set to: ${desired.join(", ")}`, () =>
        ctx.client.post("/api/project_tags/set", {
            project: ctx.projectKey,
            tags: desired.join(",")
        })
    );
}
