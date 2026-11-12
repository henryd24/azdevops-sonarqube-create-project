import * as tl from "azure-pipelines-task-lib";
import fetchMock from "jest-fetch-mock";
import { run } from "../libs/task";
import { mockSonar, posts } from "./helpers";

// With TLS options the client uses undici's fetch; route it to the mocked global fetch.
jest.mock("undici", () => ({
    Agent: jest.fn(),
    fetch: (url: string, init: RequestInit) => fetch(url, init)
}));

describe("task", () => {
    let inputs: Record<string, string>;
    let outputs: Record<string, string>;
    let setResult: jest.SpyInstance;

    beforeEach(() => {
        jest.restoreAllMocks();
        fetchMock.resetMocks();
        inputs = { Sonarqube: "endpoint", serviceKey: "my-project", serviceName: "My Project", createProject: "true", visibility: "private" };
        outputs = {};
        jest.spyOn(tl, "getInput").mockImplementation((name: string) => inputs[name]);
        jest.spyOn(tl, "getBoolInput").mockImplementation((name: string) => inputs[name] === "true");
        jest.spyOn(tl, "getEndpointAuthorizationParameter").mockReturnValue("token");
        jest.spyOn(tl, "getEndpointUrl").mockReturnValue("https://sonar.example.com");
        jest.spyOn(tl, "setVariable").mockImplementation((name: string, value: string) => { outputs[name] = value; });
        setResult = jest.spyOn(tl, "setResult").mockImplementation();
        jest.spyOn(console, "info").mockImplementation();
        jest.spyOn(console, "warn").mockImplementation();
    });

    const existing = (visibility = "public", tags: string[] = []) => ({
        "GET /api/components/show": { body: { component: { key: "my-project", name: "My Project", visibility, tags } } }
    });

    test("only checks existence and fails when the project is missing", async () => {
        inputs.createProject = "false";
        const calls = mockSonar({});
        await run();
        expect(posts(calls)).toHaveLength(0);
        expect(setResult).toHaveBeenCalledWith(tl.TaskResult.Failed, "The my-project project does NOT exist.");
        expect(outputs.SonarProjectExists).toBe("false");
    });

    test("creates the project, applies the configuration and sets output variables", async () => {
        Object.assign(inputs, {
            tags: "Dev,node", mainBranch: "trunk", permissionTemplate: "Default", groupPermissions: "devs=user",
            newCodeDefinitionType: "NUMBER_OF_DAYS", newCodeDefinitionValue: "30", long_live_branches: "(main|release/.*)"
        });
        let created = false;
        const calls = mockSonar({
            "GET /api/components/show": () => created ? { body: { component: { key: "my-project", tags: [] } } } : undefined,
            "POST /api/projects/create": () => { created = true; return { body: { project: { key: "my-project", name: "My Project" } } }; },
            "GET /api/permissions/groups": { body: { groups: [] } },
            "GET /api/settings/list_definitions": { body: { definitions: [] } },
            "GET /api/settings/values": { body: { settings: [] } },
            "GET /api/new_code_periods/show": { body: { type: "PREVIOUS_VERSION", inherited: true } },
            "GET /api/project_branches/list": { body: { branches: [{ name: "trunk", isMain: true }] } }
        });
        await run();
        const create = posts(calls, "/api/projects/create")[0];
        expect(Object.fromEntries(create.params)).toEqual({ project: "my-project", name: "My Project", visibility: "private", mainBranch: "trunk" });
        expect(posts(calls, "/api/project_tags/set")[0].params.get("tags")).toBe("dev,node");
        expect(posts(calls, "/api/new_code_periods/set")[0].params.get("value")).toBe("30");
        expect(posts(calls, "/api/settings/set")[0].params.getAll("values")).toEqual(["(main|release/.*)"]);
        // The main branch is set on creation.
        expect(posts(calls).filter(c => c.path.startsWith("/api/project_branches/"))).toHaveLength(0);
        const permissionPaths = posts(calls).map(c => c.path).filter(p => p.startsWith("/api/permissions/"));
        expect(permissionPaths).toEqual(["/api/permissions/apply_template", "/api/permissions/add_group"]);
        // The template runs alone right after the creation, before any other change.
        expect(posts(calls).map(c => c.path).slice(0, 2)).toEqual(["/api/projects/create", "/api/permissions/apply_template"]);
        expect(posts(calls, "/api/projects/update_visibility")).toHaveLength(0);
        expect(setResult).not.toHaveBeenCalled();
        expect(outputs).toMatchObject({
            SonarProjectKey: "my-project",
            SonarProjectCreated: "true",
            SonarProjectExists: "false",
            SonarProjectUrl: "https://sonar.example.com/dashboard?id=my-project"
        });
    });

    test("does not touch the new code definition or main branch of existing projects unless configured", async () => {
        inputs.permissionTemplate = "Default";
        const calls = mockSonar(existing());
        await run();
        expect(calls.map(c => c.path)).toEqual(["/api/components/show"]);
        expect(outputs.SonarProjectCreated).toBe("false");
        expect(setResult).not.toHaveBeenCalled();
    });

    test("enforces visibility on existing projects when requested", async () => {
        inputs.enforceVisibility = "true";
        const calls = mockSonar(existing("public"));
        await run();
        expect(posts(calls, "/api/projects/update_visibility")[0].params.get("visibility")).toBe("private");
    });

    test("dry run does not create or modify anything", async () => {
        Object.assign(inputs, { dryRun: "true", tags: "dev" });
        let calls = mockSonar({});
        await run();
        expect(posts(calls)).toHaveLength(0);

        fetchMock.resetMocks();
        calls = mockSonar(existing());
        await run();
        expect(posts(calls)).toHaveLength(0);
        expect(console.info).toHaveBeenCalledWith(expect.stringContaining("[dry-run] Tags set to: dev"));
    });

    test("reports failed steps as SucceededWithIssues by default", async () => {
        inputs.tags = "dev";
        mockSonar({ ...existing(), "POST /api/project_tags/set": { status: 400, body: { errors: [{ msg: "Invalid tag" }] } } });
        await run();
        expect(setResult).toHaveBeenCalledWith(tl.TaskResult.SucceededWithIssues, expect.stringContaining("Invalid tag"));
    });

    test("fails the task on configuration errors when failOnConfigError is enabled", async () => {
        Object.assign(inputs, { tags: "dev", failOnConfigError: "true" });
        mockSonar({ ...existing(), "POST /api/project_tags/set": { status: 400, body: { errors: [{ msg: "Invalid tag" }] } } });
        await run();
        expect(setResult).toHaveBeenCalledWith(tl.TaskResult.Failed, expect.stringContaining("Tags: "));
    });

    test("fails fast with a clear message on authentication errors", async () => {
        const calls = mockSonar({ "GET /api/components/show": { status: 401, body: { errors: [{ msg: "Unauthorized" }] } } });
        await run();
        expect(posts(calls)).toHaveLength(0);
        expect(setResult).toHaveBeenCalledWith(tl.TaskResult.Failed, expect.stringContaining("Check the token"));
    });

    test("stops when the lookup fails instead of trying to create the project", async () => {
        const calls = mockSonar({ "GET /api/components/show": { status: 400, body: { errors: [{ msg: "Bad request" }] } } });
        await run();
        expect(posts(calls)).toHaveLength(0);
        expect(setResult).toHaveBeenCalledWith(tl.TaskResult.Failed, expect.stringContaining("HTTP 400"));
    });

    test("fails on invalid input before calling the API", async () => {
        Object.assign(inputs, { newCodeDefinitionType: "NUMBER_OF_DAYS", newCodeDefinitionValue: "120" });
        await run();
        expect(fetchMock.mock.calls).toHaveLength(0);
        expect(setResult).toHaveBeenCalledWith(tl.TaskResult.Failed, expect.stringContaining("between 1 and 90"));
    });

    test("warns when TLS validation is disabled", async () => {
        inputs.allowInsecureSsl = "true";
        const calls = mockSonar(existing());
        await run();
        expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("TLS certificate validation is disabled"));
        expect(calls).toHaveLength(1);
        expect(require("undici").Agent).toHaveBeenCalledWith({ connect: { rejectUnauthorized: false } });
    });
});
