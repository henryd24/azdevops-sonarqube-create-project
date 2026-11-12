import { NewCodeDefinition } from "./config";
import { StepContext } from "./step";

/**
 * Replaces the long-lived branches regex (sonar.branch.longLivedBranches.regex), removed in SonarQube 8.1.
 * Multi-value setting: each comma-separated regex is a value. Only editions with branch analysis use it.
 */
export const BRANCHES_TO_KEEP_KEY = "sonar.dbcleaner.branchesToKeepWhenInactive";

interface SettingValue {
    key: string;
    value?: string;
    values?: string[];
    inherited?: boolean;
}

interface SettingDefinition {
    key: string;
    multiValues?: boolean;
}

interface Branch {
    name: string;
    isMain: boolean;
}

/**
 * Builds the ordered map of settings to apply. Explicit task inputs take precedence over `additionalSettings`.
 */
export function buildDesiredSettings(additional: Map<string, string>, branchesToKeep?: string): Map<string, string> {
    const desired = new Map(additional);
    if (branchesToKeep) desired.set(BRANCHES_TO_KEEP_KEY, branchesToKeep);
    return desired;
}

async function multiValueKeys(ctx: StepContext, keys: string[]): Promise<Set<string>> {
    try {
        const result = await ctx.client.get<{ definitions?: SettingDefinition[] }>("/api/settings/list_definitions", {
            component: ctx.projectKey
        });
        const multi = new Set((result.definitions ?? []).filter(d => d.multiValues && keys.includes(d.key)).map(d => d.key));
        // Defined by the branch plugin, so it may be missing from the definitions; it is always multi-value.
        if (keys.includes(BRANCHES_TO_KEEP_KEY)) multi.add(BRANCHES_TO_KEEP_KEY);
        return multi;
    } catch {
        return new Set(keys.filter(k => k === BRANCHES_TO_KEEP_KEY));
    }
}

async function currentValues(ctx: StepContext, keys: string[]): Promise<Map<string, SettingValue>> {
    try {
        const result = await ctx.client.get<{ settings?: SettingValue[] }>("/api/settings/values", {
            component: ctx.projectKey,
            keys: keys.join(",")
        });
        return new Map((result.settings ?? []).map(s => [s.key, s]));
    } catch {
        return new Map();
    }
}

function splitMulti(value: string): string[] {
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

function isUpToDate(current: SettingValue | undefined, desired: string, multi: boolean): boolean {
    // Inherited values are always re-applied so the project does not change when the global default does.
    if (!current || current.inherited) return false;
    // Where the key is not defined (e.g. branchesToKeepWhenInactive on Community Build) the server
    // answers the multi-value setting as a single comma-joined value.
    if (multi) return (current.values ?? splitMulti(current.value ?? "")).join(",") === splitMulti(desired).join(",");
    return current.value === desired;
}

export async function ensureSettings(ctx: StepContext, desired: Map<string, string>): Promise<void> {
    const keys = [...desired.keys()];
    if (keys.length === 0) return;
    const [multi, current] = await Promise.all([multiValueKeys(ctx, keys), currentValues(ctx, keys)]);

    for (const [key, value] of desired) {
        const isMulti = multi.has(key);
        if (isUpToDate(current.get(key), value, isMulti)) continue;
        const params = isMulti
            ? { component: ctx.projectKey, key, values: splitMulti(value) }
            : { component: ctx.projectKey, key, value };
        await ctx.apply(`Setting ${key} = ${value}`, () => ctx.client.post("/api/settings/set", params));
    }
}

async function listBranches(ctx: StepContext): Promise<Branch[]> {
    const result = await ctx.client.get<{ branches?: Branch[] }>("/api/project_branches/list", { project: ctx.projectKey });
    return result.branches ?? [];
}

/**
 * If a branch with that name was already analyzed it becomes the main branch
 * (api/project_branches/set_main, SonarQube 10.2+). Otherwise the main branch is renamed.
 */
export async function ensureMainBranch(ctx: StepContext, name: string): Promise<void> {
    const branches = await listBranches(ctx);
    const current = branches.find(b => b.isMain)?.name;
    if (current === name) return;
    if (branches.some(b => b.name === name)) {
        await ctx.apply(`Main branch switched from ${current ?? "unknown"} to existing branch ${name}`, () =>
            ctx.client.post("/api/project_branches/set_main", { project: ctx.projectKey, branch: name })
        );
        return;
    }
    await ctx.apply(`Main branch renamed from ${current ?? "unknown"} to ${name}`, () =>
        ctx.client.post("/api/project_branches/rename", { project: ctx.projectKey, name })
    );
}

interface NewCodePeriod {
    type?: string;
    value?: string;
    inherited?: boolean;
}

/**
 * New code definition through api/new_code_periods (the sonar.leak.period settings are no longer used).
 * REFERENCE_BRANCH without value points to the main branch.
 *
 * SonarQube Community Build has no branch analysis and stores a project-level definition on the
 * main branch, so the project level keeps answering "inherited"; the main branch is checked too.
 */
export async function ensureNewCodeDefinition(ctx: StepContext, desired: NewCodeDefinition, mainBranch?: string): Promise<void> {
    let main: string | undefined;
    const resolveMain = async () => main ??= (await listBranches(ctx).catch(() => [] as Branch[])).find(b => b.isMain)?.name;

    let value = desired.value;
    if (desired.type === "REFERENCE_BRANCH" && !value) {
        value = mainBranch ?? await resolveMain();
        if (!value) throw new Error("Could not determine the main branch to use as reference branch.");
    }
    const matches = (current?: NewCodePeriod) =>
        !!current && !current.inherited && current.type === desired.type && (desired.type === "PREVIOUS_VERSION" || current.value === value);
    const show = (branch?: string) =>
        ctx.client.get<NewCodePeriod>("/api/new_code_periods/show", { project: ctx.projectKey, branch }).catch(() => undefined);

    if (matches(await show())) return;
    const branch = await resolveMain();
    if (branch && matches(await show(branch))) return;

    const description = value ? `${desired.type} (${value})` : desired.type;
    await ctx.apply(`New code definition set to ${description}`, () =>
        ctx.client.post("/api/new_code_periods/set", { project: ctx.projectKey, type: desired.type, value })
    );
}
