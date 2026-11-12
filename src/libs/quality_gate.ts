import { StepContext } from "./step";

interface QualityGateRef {
    name: string;
}

export class QualityGateNotFoundError extends Error {
    constructor(gate: string, available: QualityGateRef[]) {
        super(`Quality gate '${gate}' was not found. Available: ${available.map(g => g.name).join(", ")}`);
        this.name = "QualityGateNotFoundError";
    }
}

/**
 * The gate is selected by name (api/qualitygates/select uses gateName since 8.4; gateId was removed in 10.0).
 * The name comparison is case-insensitive to tolerate inputs typed by hand.
 */
export async function ensureQualityGate(ctx: StepContext, gate: string): Promise<void> {
    const result = await ctx.client.get<{ qualitygates?: QualityGateRef[] }>("/api/qualitygates/list");
    const gates = result.qualitygates ?? [];
    const desired = gates.find(g => g.name === gate) ?? gates.find(g => g.name.toLowerCase() === gate.toLowerCase());
    if (!desired) throw new QualityGateNotFoundError(gate, gates);

    const current = await ctx.client.get<{ qualityGate?: { name: string; default?: boolean } }>("/api/qualitygates/get_by_project", {
        project: ctx.projectKey
    }).catch(() => undefined);
    // A project that only falls back to the default gate is associated explicitly,
    // so it does not change when the default quality gate changes.
    if (current?.qualityGate?.name === desired.name && !current.qualityGate.default) return;

    await ctx.apply(`Quality gate set to '${desired.name}'`, () =>
        ctx.client.post("/api/qualitygates/select", {
            projectKey: ctx.projectKey,
            gateName: desired.name
        })
    );
}
