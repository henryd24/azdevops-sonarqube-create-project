import fetchMock from "jest-fetch-mock";
import { ensureVisibility, Projects } from "../libs/projects";
import { ensureTags } from "../libs/tags";
import { ensureQualityGate, QualityGateNotFoundError } from "../libs/quality_gate";
import { ensureQualityProfiles } from "../libs/quality_profiles";
import { BRANCHES_TO_KEEP_KEY, buildDesiredSettings, ensureMainBranch, ensureNewCodeDefinition, ensureSettings } from "../libs/settings";
import { applyPermissionTemplate, ensurePermissions } from "../libs/permissions";
import { runStep } from "../libs/step";
import { mockSonar, newClient, newContext, posts } from "./helpers";

beforeEach(() => fetchMock.resetMocks());

describe("Projects", () => {
    test("finds a project with api/components/show and treats 404 as missing", async () => {
        let calls = mockSonar({ "GET /api/components/show": { body: { component: { key: "my-project", name: "P", visibility: "private" } } } });
        await expect(new Projects(newClient()).find("my-project")).resolves.toMatchObject({ key: "my-project", visibility: "private" });
        expect(calls[0].params.get("component")).toBe("my-project");

        fetchMock.resetMocks();
        mockSonar({});
        await expect(new Projects(newClient()).find("my-project")).resolves.toBeUndefined();
    });

    test("propagates errors other than 404", async () => {
        mockSonar({ "GET /api/components/show": { status: 403, body: { errors: [{ msg: "Insufficient privileges" }] } } });
        await expect(new Projects(newClient()).find("my-project")).rejects.toThrow("Insufficient privileges");
    });

    test("creates a project with the main branch and builds its URL", async () => {
        const calls = mockSonar({ "POST /api/projects/create": { body: { project: { key: "my-project", name: "My & Project" } } } });
        const projects = new Projects(newClient());
        await expect(projects.create("my-project", "My & Project", "private", "trunk")).resolves.toMatchObject({ visibility: "private" });
        expect(Object.fromEntries(calls[0].params)).toEqual({ project: "my-project", name: "My & Project", visibility: "private", mainBranch: "trunk" });
        expect(projects.projectUrl("my-project")).toBe("https://sonar.example.com/dashboard?id=my-project");
    });

    test("rejects unexpected create responses", async () => {
        mockSonar({ "POST /api/projects/create": { body: { project: { key: "other" } } } });
        await expect(new Projects(newClient()).create("my-project", "n", "private")).rejects.toThrow(/Unexpected response/);
    });
});

describe("visibility", () => {
    test("only updates when it differs", async () => {
        const calls = mockSonar({});
        await ensureVisibility(newContext(), "private", "private");
        await ensureVisibility(newContext(), "public", "private");
        expect(posts(calls, "/api/projects/update_visibility")).toHaveLength(1);
    });
});

describe("tags", () => {
    test("skips when the tags are already set", async () => {
        const calls = mockSonar({ "GET /api/components/show": { body: { component: { tags: ["node", "dev"] } } } });
        await ensureTags(newContext(), ["dev", "node"]);
        expect(posts(calls)).toHaveLength(0);
    });

    test("sets the tags when they differ or cannot be read", async () => {
        const calls = mockSonar({});
        await ensureTags(newContext(), ["dev", "node"]);
        expect(posts(calls, "/api/project_tags/set")[0].params.get("tags")).toBe("dev,node");
    });
});

describe("quality gate", () => {
    const gates = { "GET /api/qualitygates/list": { body: { qualitygates: [{ name: "Sonar way" }, { name: "Company Way" }] } } };

    test("selects the gate by name, case-insensitive", async () => {
        const calls = mockSonar({ ...gates, "GET /api/qualitygates/get_by_project": { body: { qualityGate: { name: "Sonar way", default: true } } } });
        await ensureQualityGate(newContext(), "company way");
        const select = posts(calls, "/api/qualitygates/select")[0];
        expect(select.params.get("gateName")).toBe("Company Way");
        expect(select.params.get("projectKey")).toBe("my-project");
        expect(select.params.has("gateId")).toBe(false);
    });

    test("skips when the gate is explicitly associated and re-selects a default fallback", async () => {
        let calls = mockSonar({ ...gates, "GET /api/qualitygates/get_by_project": { body: { qualityGate: { name: "Sonar way" } } } });
        await ensureQualityGate(newContext(), "Sonar way");
        expect(posts(calls)).toHaveLength(0);

        fetchMock.resetMocks();
        calls = mockSonar({ ...gates, "GET /api/qualitygates/get_by_project": { body: { qualityGate: { name: "Sonar way", default: true } } } });
        await ensureQualityGate(newContext(), "Sonar way");
        expect(posts(calls, "/api/qualitygates/select")).toHaveLength(1);
    });

    test("fails listing the available gates when not found", async () => {
        mockSonar(gates);
        const error = await ensureQualityGate(newContext(), "Missing").catch(e => e);
        expect(error).toBeInstanceOf(QualityGateNotFoundError);
        expect(error.message).toContain("Sonar way, Company Way");
    });
});

describe("quality profiles", () => {
    test("only associates the profiles that differ", async () => {
        const calls = mockSonar({
            "GET /api/qualityprofiles/search": { body: { profiles: [{ key: "1", name: "Company", language: "ts" }, { key: "2", name: "Sonar way", language: "js" }] } }
        });
        await ensureQualityProfiles(newContext(), new Map([["ts", "Company"], ["js", "Company"]]));
        const added = posts(calls, "/api/qualityprofiles/add_project");
        expect(added).toHaveLength(1);
        expect(Object.fromEntries(added[0].params)).toEqual({ project: "my-project", language: "js", qualityProfile: "Company" });
    });
});

describe("settings", () => {
    test("maps the long-lived branches input to branchesToKeepWhenInactive and lets inputs win", () => {
        const desired = buildDesiredSettings(new Map([[BRANCHES_TO_KEEP_KEY, "x"], ["sonar.exclusions", "a"]]), "(main|release/.*)");
        expect([...desired]).toEqual([[BRANCHES_TO_KEEP_KEY, "(main|release/.*)"], ["sonar.exclusions", "a"]]);
    });

    test("sends multi-value settings as repeated values and skips up-to-date ones", async () => {
        const calls = mockSonar({
            "GET /api/settings/list_definitions": { body: { definitions: [{ key: "sonar.exclusions", multiValues: true }] } },
            "GET /api/settings/values": {
                body: { settings: [{ key: "sonar.exclusions", values: ["a", "b"] }, { key: "sonar.cpd.exclusions", value: "x", inherited: true }] }
            }
        });
        await ensureSettings(newContext(), new Map([
            ["sonar.exclusions", "a, b"],
            ["sonar.cpd.exclusions", "x"],
            [BRANCHES_TO_KEEP_KEY, "main,release/.*"]
        ]));
        const sets = posts(calls, "/api/settings/set");
        expect(sets.map(s => s.params.get("key"))).toEqual(["sonar.cpd.exclusions", BRANCHES_TO_KEEP_KEY]);
        expect(sets[0].params.get("value")).toBe("x");
        expect(sets[1].params.getAll("values")).toEqual(["main", "release/.*"]);
        expect(sets[1].params.has("value")).toBe(false);
    });
    test("treats a comma-joined single value as up to date for multi-value settings", async () => {
        const calls = mockSonar({
            "GET /api/settings/list_definitions": { body: { definitions: [] } },
            "GET /api/settings/values": { body: { settings: [{ key: BRANCHES_TO_KEEP_KEY, value: "main,release/.*" }] } }
        });
        await ensureSettings(newContext(), new Map([[BRANCHES_TO_KEEP_KEY, "main, release/.*"]]));
        expect(posts(calls)).toHaveLength(0);
    });
});

describe("main branch", () => {
    const branches = { "GET /api/project_branches/list": { body: { branches: [{ name: "master", isMain: true }, { name: "develop", isMain: false }] } } };

    test("does nothing when it is already the main branch", async () => {
        const calls = mockSonar(branches);
        await ensureMainBranch(newContext(), "master");
        expect(posts(calls)).toHaveLength(0);
    });

    test("switches to an existing branch with set_main", async () => {
        const calls = mockSonar(branches);
        await ensureMainBranch(newContext(), "develop");
        expect(Object.fromEntries(posts(calls, "/api/project_branches/set_main")[0].params)).toEqual({ project: "my-project", branch: "develop" });
    });

    test("renames the main branch when the branch does not exist", async () => {
        const calls = mockSonar(branches);
        await ensureMainBranch(newContext(), "main");
        expect(posts(calls, "/api/project_branches/rename")[0].params.get("name")).toBe("main");
    });
});

describe("new code definition", () => {
    test("skips an equal project-level definition", async () => {
        const calls = mockSonar({ "GET /api/new_code_periods/show": { body: { type: "NUMBER_OF_DAYS", value: "30", inherited: false } } });
        await ensureNewCodeDefinition(newContext(), { type: "NUMBER_OF_DAYS", value: "30" });
        expect(posts(calls)).toHaveLength(0);
    });

    test("sets the definition when it is inherited or differs", async () => {
        const calls = mockSonar({ "GET /api/new_code_periods/show": { body: { type: "PREVIOUS_VERSION", inherited: true } } });
        await ensureNewCodeDefinition(newContext(), { type: "PREVIOUS_VERSION" });
        const set = posts(calls, "/api/new_code_periods/set")[0];
        expect(Object.fromEntries(set.params)).toEqual({ project: "my-project", type: "PREVIOUS_VERSION" });
    });

    test("skips when the definition is stored on the main branch (Community Build)", async () => {
        const calls = mockSonar({
            "GET /api/project_branches/list": { body: { branches: [{ name: "trunk", isMain: true }] } },
            "GET /api/new_code_periods/show": call => call.params.get("branch") === "trunk"
                ? { body: { type: "NUMBER_OF_DAYS", value: "30" } }
                : { body: { type: "PREVIOUS_VERSION", inherited: true } }
        });
        await ensureNewCodeDefinition(newContext(), { type: "NUMBER_OF_DAYS", value: "30" });
        expect(posts(calls)).toHaveLength(0);
    });

    test("uses the main branch as reference branch when no value is given", async () => {
        let calls = mockSonar({ "GET /api/project_branches/list": { body: { branches: [{ name: "trunk", isMain: true }] } } });
        await ensureNewCodeDefinition(newContext(), { type: "REFERENCE_BRANCH" });
        expect(posts(calls, "/api/new_code_periods/set")[0].params.get("value")).toBe("trunk");

        fetchMock.resetMocks();
        calls = mockSonar({});
        await ensureNewCodeDefinition(newContext(), { type: "REFERENCE_BRANCH" }, "main");
        expect(posts(calls, "/api/new_code_periods/set")[0].params.get("value")).toBe("main");
    });
});

describe("permissions", () => {
    test("applies the template", async () => {
        const calls = mockSonar({});
        await applyPermissionTemplate(newContext(), "Default");
        expect(Object.fromEntries(posts(calls)[0].params)).toEqual({ projectKey: "my-project", templateName: "Default" });
    });

    test("grants only missing permissions and omits private-only ones on public projects", async () => {
        const calls = mockSonar({ "GET /api/permissions/groups": { body: { groups: [{ name: "devs", permissions: ["scan"] }] } } });
        const ctx = newContext();
        await ensurePermissions(ctx, "group", [{ principal: "devs", permissions: ["scan", "user", "issueadmin"] }], "public");
        const added = posts(calls, "/api/permissions/add_group");
        expect(added.map(a => a.params.get("permission"))).toEqual(["issueadmin"]);
        expect(added[0].params.get("groupName")).toBe("devs");
        expect(ctx.notes[0]).toContain("'user'");
    });

    test("grants user permissions by login", async () => {
        const calls = mockSonar({ "GET /api/permissions/users": { body: { users: [] } } });
        await ensurePermissions(newContext(), "user", [{ principal: "jdoe", permissions: ["admin"] }], "private");
        expect(posts(calls, "/api/permissions/add_user")[0].params.get("login")).toBe("jdoe");
    });
});

describe("runStep", () => {
    test("records planned changes in dry-run and captures errors", async () => {
        const calls = mockSonar({});
        const dry = await runStep("Tags", ctx => ensureTags(ctx, ["a"]), newClient(), "my-project", true);
        expect(dry.changes).toEqual(["[dry-run] Tags set to: a"]);
        expect(posts(calls)).toHaveLength(0);

        const failed = await runStep("Boom", async () => { throw new Error("boom"); }, newClient(), "my-project", false);
        expect(failed.error).toBe("boom");
    });
});
