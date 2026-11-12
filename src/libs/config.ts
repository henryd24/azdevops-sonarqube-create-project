import * as tl from "azure-pipelines-task-lib";
import { TlsOptions } from "./client";

export type Visibility = "private" | "public";
export type NewCodeType = "PREVIOUS_VERSION" | "NUMBER_OF_DAYS" | "REFERENCE_BRANCH";

export const PROJECT_PERMISSIONS = ["admin", "codeviewer", "issueadmin", "securityhotspotadmin", "scan", "user"] as const;
export type ProjectPermission = typeof PROJECT_PERMISSIONS[number];

export interface NewCodeDefinition {
    type: NewCodeType;
    /** Days for NUMBER_OF_DAYS, branch for REFERENCE_BRANCH (empty = main branch), unused for PREVIOUS_VERSION. */
    value?: string;
}

export interface PermissionGrant {
    principal: string;
    permissions: ProjectPermission[];
}

export interface TaskConfig {
    endpointId: string;
    baseUrl: string;
    token: string;
    tls: TlsOptions;
    projectKey: string;
    projectName: string;
    createProject: boolean;
    visibility: Visibility;
    enforceVisibility: boolean;
    mainBranch?: string;
    tags: string[];
    branchesToKeepWhenInactive?: string;
    qualityGate?: string;
    newCodeDefinition?: NewCodeDefinition;
    additionalSettings: Map<string, string>;
    qualityProfiles: Map<string, string>;
    permissionTemplate?: string;
    groupPermissions: PermissionGrant[];
    userPermissions: PermissionGrant[];
    dryRun: boolean;
    failOnConfigError: boolean;
}

export class ConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ConfigError";
    }
}

function optional(name: string): string | undefined {
    const value = tl.getInput(name, false)?.trim();
    return value ? value : undefined;
}

/**
 * Parses multi-line "key=value" inputs. Empty lines and lines starting with # are ignored.
 * Only the first "=" splits key and value, so values may contain "=".
 */
export function parseKeyValueLines(input: string | undefined, inputName: string): Map<string, string> {
    const result = new Map<string, string>();
    if (!input) return result;
    input.split(/\r?\n/).forEach((raw, index) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        const separator = line.indexOf("=");
        if (separator <= 0) {
            throw new ConfigError(`Invalid entry in '${inputName}' at line ${index + 1}: '${line}'. Expected format key=value.`);
        }
        result.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    });
    return result;
}

export function parseList(input: string | undefined): string[] {
    if (!input) return [];
    return input.split(/[,\n]/).map(t => t.trim()).filter(Boolean);
}

export function normalizeTags(input: string | undefined): string[] {
    return [...new Set(parseList(input).map(t => t.toLowerCase()))];
}

export function parsePermissionGrants(input: string | undefined, inputName: string): PermissionGrant[] {
    const grants: PermissionGrant[] = [];
    parseKeyValueLines(input, inputName).forEach((value, principal) => {
        const permissions = parseList(value).map(p => p.toLowerCase());
        if (permissions.length === 0) {
            throw new ConfigError(`No permissions defined for '${principal}' in '${inputName}'.`);
        }
        const invalid = permissions.filter(p => !(PROJECT_PERMISSIONS as readonly string[]).includes(p));
        if (invalid.length > 0) {
            throw new ConfigError(`Invalid permission(s) '${invalid.join(", ")}' for '${principal}' in '${inputName}'. Allowed: ${PROJECT_PERMISSIONS.join(", ")}.`);
        }
        grants.push({ principal, permissions: permissions as ProjectPermission[] });
    });
    return grants;
}

/**
 * Types accepted by api/new_code_periods/set at project level. The type is case-insensitive
 * so `previous_version` (the SonarCloud task spelling) also works.
 */
export function validateNewCodeDefinition(type: string, value: string | undefined): NewCodeDefinition {
    switch (type.toUpperCase()) {
        case "PREVIOUS_VERSION":
            return { type: "PREVIOUS_VERSION" };
        case "NUMBER_OF_DAYS": {
            if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 90) {
                throw new ConfigError(`New code definition type NUMBER_OF_DAYS requires a number between 1 and 90, received '${value ?? ""}'.`);
            }
            return { type: "NUMBER_OF_DAYS", value: String(Number(value)) };
        }
        case "REFERENCE_BRANCH":
            return { type: "REFERENCE_BRANCH", value };
        default:
            throw new ConfigError(`Unsupported new code definition type '${type}'. Allowed: PREVIOUS_VERSION, NUMBER_OF_DAYS, REFERENCE_BRANCH.`);
    }
}

/**
 * Project keys may contain letters, digits, '-', '_', '.' and ':' and must contain at least one non-digit.
 */
export function sanitizeProjectKey(raw: string): string {
    return raw.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-").replace(/^-+|-+$/g, "");
}

function resolveProjectKey(): string {
    const explicit = optional("serviceKey");
    if (explicit) return explicit;
    const repositoryName = tl.getVariable("Build.Repository.Name");
    if (!repositoryName) {
        throw new ConfigError("Input 'serviceKey' is empty and the variable Build.Repository.Name is not available to derive it.");
    }
    // Repository names may include the owner (e.g. owner/repo on GitHub); keep only the repository part.
    return sanitizeProjectKey(repositoryName.split("/").pop()!);
}

/**
 * The SonarQube service connection (from the SonarQube extension) stores the token as the user name.
 */
function readToken(endpointId: string): string | undefined {
    for (const parameter of ["username", "apitoken"]) {
        const value = tl.getEndpointAuthorizationParameter(endpointId, parameter, true);
        if (value) return value;
    }
    return undefined;
}

export function readConfig(): TaskConfig {
    const endpointId = tl.getInput("Sonarqube", true)!;
    const token = readToken(endpointId);
    if (!token) {
        throw new ConfigError("The SonarQube service connection does not provide a token.");
    }
    const baseUrl = tl.getEndpointUrl(endpointId, false);
    if (!baseUrl) {
        throw new ConfigError("The SonarQube service connection does not define the server URL.");
    }

    const projectKey = resolveProjectKey();
    if (!/^[A-Za-z0-9_.:-]+$/.test(projectKey) || /^\d+$/.test(projectKey)) {
        throw new ConfigError(`Invalid project key '${projectKey}'. Allowed characters: letters, digits, '-', '_', '.', ':' with at least one non-digit.`);
    }

    const visibility = (optional("visibility") ?? "private") as Visibility;
    if (visibility !== "private" && visibility !== "public") {
        throw new ConfigError(`Invalid visibility '${visibility}'. Allowed: private, public.`);
    }

    const newCodeType = optional("newCodeDefinitionType");
    const newCodeDefinition = newCodeType
        ? validateNewCodeDefinition(newCodeType, optional("newCodeDefinitionValue"))
        : undefined;

    const caCertificatePath = optional("caCertificate");
    if (caCertificatePath && !tl.exist(caCertificatePath)) {
        throw new ConfigError(`The CA certificate file '${caCertificatePath}' does not exist.`);
    }

    return {
        endpointId,
        baseUrl,
        token,
        tls: { insecure: tl.getBoolInput("allowInsecureSsl", false), caCertificatePath },
        projectKey,
        projectName: optional("serviceName") ?? projectKey,
        createProject: (optional("createProject") ?? "true") === "true",
        visibility,
        enforceVisibility: tl.getBoolInput("enforceVisibility", false),
        mainBranch: optional("mainBranch"),
        tags: normalizeTags(optional("tags")),
        branchesToKeepWhenInactive: optional("long_live_branches"),
        qualityGate: optional("sonarQualityGate"),
        newCodeDefinition,
        additionalSettings: parseKeyValueLines(optional("additionalSettings"), "additionalSettings"),
        qualityProfiles: parseKeyValueLines(optional("qualityProfiles"), "qualityProfiles"),
        permissionTemplate: optional("permissionTemplate"),
        groupPermissions: parsePermissionGrants(optional("groupPermissions"), "groupPermissions"),
        userPermissions: parsePermissionGrants(optional("userPermissions"), "userPermissions"),
        dryRun: tl.getBoolInput("dryRun", false),
        failOnConfigError: tl.getBoolInput("failOnConfigError", false)
    };
}
