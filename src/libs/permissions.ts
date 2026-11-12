import { PermissionGrant, Visibility } from "./config";
import { StepContext } from "./step";

type PrincipalKind = "group" | "user";

/** Public projects can be browsed by anyone, so SonarQube rejects these permissions on them. */
const PRIVATE_ONLY_PERMISSIONS = ["user", "codeviewer"];

interface PermissionEntry {
    name?: string;
    login?: string;
    permissions?: string[];
}

export async function applyPermissionTemplate(ctx: StepContext, templateName: string): Promise<void> {
    await ctx.apply(`Permission template '${templateName}' applied`, () =>
        ctx.client.post("/api/permissions/apply_template", {
            projectKey: ctx.projectKey,
            templateName
        })
    );
}

async function currentPermissions(ctx: StepContext, kind: PrincipalKind, principal: string): Promise<Set<string>> {
    try {
        const result = await ctx.client.get<{ groups?: PermissionEntry[]; users?: PermissionEntry[] }>(
            kind === "group" ? "/api/permissions/groups" : "/api/permissions/users",
            {
                projectKey: ctx.projectKey,
                // The search requires at least 3 characters.
                q: principal.length >= 3 ? principal : undefined,
                ps: 100
            }
        );
        const entries = (kind === "group" ? result.groups : result.users) ?? [];
        const match = entries.find(e => (kind === "group" ? e.name : e.login)?.toLowerCase() === principal.toLowerCase());
        return new Set(match?.permissions ?? []);
    } catch {
        return new Set();
    }
}

export async function ensurePermissions(
    ctx: StepContext,
    kind: PrincipalKind,
    grants: PermissionGrant[],
    visibility?: Visibility
): Promise<void> {
    for (const grant of grants) {
        let permissions = grant.permissions;
        if (visibility === "public") {
            const skipped = permissions.filter(p => PRIVATE_ONLY_PERMISSIONS.includes(p));
            if (skipped.length > 0) {
                ctx.note(`Permission(s) '${skipped.join(", ")}' for ${kind} '${grant.principal}' omitted: they do not apply to public projects.`);
                permissions = permissions.filter(p => !PRIVATE_ONLY_PERMISSIONS.includes(p));
            }
        }
        if (permissions.length === 0) continue;
        const current = await currentPermissions(ctx, kind, grant.principal);
        for (const permission of permissions) {
            if (current.has(permission)) continue;
            await ctx.apply(`Permission '${permission}' granted to ${kind} '${grant.principal}'`, () =>
                ctx.client.post(kind === "group" ? "/api/permissions/add_group" : "/api/permissions/add_user", {
                    projectKey: ctx.projectKey,
                    permission,
                    ...(kind === "group" ? { groupName: grant.principal } : { login: grant.principal })
                })
            );
        }
    }
}
