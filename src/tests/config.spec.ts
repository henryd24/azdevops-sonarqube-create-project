import * as tl from "azure-pipelines-task-lib";
import {
    ConfigError,
    normalizeTags,
    parseKeyValueLines,
    parsePermissionGrants,
    readConfig,
    sanitizeProjectKey,
    validateNewCodeDefinition
} from "../libs/config";

describe("config parsers", () => {
    test("parseKeyValueLines ignores comments and blank lines and splits on the first '='", () => {
        const result = parseKeyValueLines("# comment\n\nsonar.exclusions = **/test/**\r\nkey=a=b\n", "input");
        expect([...result]).toEqual([["sonar.exclusions", "**/test/**"], ["key", "a=b"]]);
    });

    test("parseKeyValueLines rejects lines without key", () => {
        expect(() => parseKeyValueLines("valid=1\n=nokey", "additionalSettings")).toThrow(/line 2/);
        expect(() => parseKeyValueLines("novalue", "additionalSettings")).toThrow(ConfigError);
    });

    test("normalizeTags lowercases, trims and removes duplicates", () => {
        expect(normalizeTags(" Dev, back ,dev,,NODE")).toEqual(["dev", "back", "node"]);
    });

    test("parsePermissionGrants validates permissions", () => {
        expect(parsePermissionGrants("developers=user,codeviewer\nleads=Admin", "groupPermissions")).toEqual([
            { principal: "developers", permissions: ["user", "codeviewer"] },
            { principal: "leads", permissions: ["admin"] }
        ]);
        expect(() => parsePermissionGrants("developers=owner", "groupPermissions")).toThrow(/Invalid permission/);
        expect(() => parsePermissionGrants("developers=", "groupPermissions")).toThrow(/No permissions/);
    });

    test.each([
        ["PREVIOUS_VERSION", undefined, { type: "PREVIOUS_VERSION" }],
        ["previous_version", "ignored", { type: "PREVIOUS_VERSION" }],
        ["NUMBER_OF_DAYS", "30", { type: "NUMBER_OF_DAYS", value: "30" }],
        ["NUMBER_OF_DAYS", "090", { type: "NUMBER_OF_DAYS", value: "90" }],
        ["REFERENCE_BRANCH", "develop", { type: "REFERENCE_BRANCH", value: "develop" }],
        ["REFERENCE_BRANCH", undefined, { type: "REFERENCE_BRANCH", value: undefined }]
    ])("validateNewCodeDefinition accepts %s=%s", (type, value, expected) => {
        expect(validateNewCodeDefinition(type, value)).toEqual(expected);
    });

    test.each([
        ["NUMBER_OF_DAYS", "abc"],
        ["NUMBER_OF_DAYS", "0"],
        ["NUMBER_OF_DAYS", "91"],
        ["NUMBER_OF_DAYS", undefined],
        ["SPECIFIC_ANALYSIS", "x"],
        ["date", "2024-01-01"]
    ])("validateNewCodeDefinition rejects %s=%s", (type, value) => {
        expect(() => validateNewCodeDefinition(type, value)).toThrow(ConfigError);
    });

    test("sanitizeProjectKey replaces invalid characters", () => {
        expect(sanitizeProjectKey("My Repo (v2)")).toBe("My-Repo-v2");
    });
});

describe("readConfig", () => {
    let inputs: Record<string, string>;
    let variables: Record<string, string>;
    let auth: Record<string, string>;

    beforeEach(() => {
        jest.restoreAllMocks();
        inputs = { Sonarqube: "endpoint", serviceKey: "my-project", createProject: "true", visibility: "private" };
        variables = {};
        auth = { username: "token" };
        jest.spyOn(tl, "getInput").mockImplementation((name: string) => inputs[name]);
        jest.spyOn(tl, "getBoolInput").mockImplementation((name: string) => inputs[name] === "true");
        jest.spyOn(tl, "getVariable").mockImplementation((name: string) => variables[name]);
        jest.spyOn(tl, "getEndpointAuthorizationParameter").mockImplementation((_id: string, key: string) => auth[key]);
        jest.spyOn(tl, "getEndpointUrl").mockReturnValue("https://sonar.example.com");
    });

    test("reads the basic inputs with defaults", () => {
        inputs.visibility = "";
        const config = readConfig();
        expect(config).toMatchObject({
            baseUrl: "https://sonar.example.com",
            token: "token",
            tls: { insecure: false, caCertificatePath: undefined },
            projectKey: "my-project",
            projectName: "my-project",
            createProject: true,
            visibility: "private",
            enforceVisibility: false,
            dryRun: false,
            failOnConfigError: false,
            tags: [],
            newCodeDefinition: undefined,
            branchesToKeepWhenInactive: undefined
        });
    });

    test("reads the token from the user name of the service connection, or from apitoken", () => {
        expect(readConfig().token).toBe("token");
        auth = { apitoken: "api-token" };
        expect(readConfig().token).toBe("api-token");
        auth = {};
        expect(() => readConfig()).toThrow(/does not provide a token/);
    });

    test("derives the project key from the repository name when not provided", () => {
        inputs.serviceKey = "";
        variables["Build.Repository.Name"] = "owner/My Repo";
        expect(readConfig().projectKey).toBe("My-Repo");
    });

    test("fails when the project key cannot be derived", () => {
        inputs.serviceKey = "";
        expect(() => readConfig()).toThrow(/Build.Repository.Name/);
    });

    test("rejects invalid project keys", () => {
        inputs.serviceKey = "12345";
        expect(() => readConfig()).toThrow(/Invalid project key/);
    });

    test("configures the new code definition only when a type is selected", () => {
        inputs.newCodeDefinitionValue = "abc";
        expect(readConfig().newCodeDefinition).toBeUndefined();
        inputs.newCodeDefinitionType = "NUMBER_OF_DAYS";
        expect(() => readConfig()).toThrow(/between 1 and 90/);
    });

    test("validates the CA certificate path and reads the TLS options", () => {
        inputs.caCertificate = "/missing/ca.pem";
        jest.spyOn(tl, "exist").mockReturnValue(false);
        expect(() => readConfig()).toThrow(/does not exist/);
        jest.spyOn(tl, "exist").mockReturnValue(true);
        inputs.allowInsecureSsl = "true";
        expect(readConfig().tls).toEqual({ insecure: true, caCertificatePath: "/missing/ca.pem" });
    });
});
