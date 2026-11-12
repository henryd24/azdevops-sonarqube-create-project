import { SonarClient } from "./client";

export interface StepOutcome {
    name: string;
    changes: string[];
    notes: string[];
    error?: string;
}

/**
 * Shared context for the configuration steps. Each step compares the desired state
 * with the current one and only calls `apply` for what differs, so the task is idempotent.
 * In dry-run mode `apply` records the planned change without executing it.
 */
export class StepContext {
    readonly changes: string[] = [];
    readonly notes: string[] = [];

    constructor(
        readonly client: SonarClient,
        readonly projectKey: string,
        readonly dryRun: boolean
    ) { }

    note(message: string): void {
        this.notes.push(message);
    }

    async apply(description: string, action: () => Promise<unknown>): Promise<void> {
        if (this.dryRun) {
            this.changes.push(`[dry-run] ${description}`);
            return;
        }
        await action();
        this.changes.push(description);
    }
}

export type Step = (ctx: StepContext) => Promise<void>;

/**
 * Runs the step with its own context so that changes are reported per step even when
 * several steps run concurrently. Errors are captured instead of thrown.
 */
export async function runStep(
    name: string,
    step: Step,
    client: SonarClient,
    projectKey: string,
    dryRun: boolean
): Promise<StepOutcome> {
    const ctx = new StepContext(client, projectKey, dryRun);
    try {
        await step(ctx);
        return { name, changes: ctx.changes, notes: ctx.notes };
    } catch (err) {
        return { name, changes: ctx.changes, notes: ctx.notes, error: (err as Error).message };
    }
}
