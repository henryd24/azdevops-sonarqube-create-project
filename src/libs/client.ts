import * as fs from "fs";
import * as tl from "azure-pipelines-task-lib";
import { Agent, fetch as undiciFetch } from "undici";

export type Params = Record<string, string | number | boolean | string[] | undefined>;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TlsOptions {
    /** Skips the certificate validation. Only for servers with self-signed certificates. */
    insecure?: boolean;
    /** PEM file with the CA (or chain) that signed the server certificate. */
    caCertificatePath?: string;
}

export interface ClientOptions {
    timeoutMs?: number;
    retries?: number;
    retryDelayMs?: number;
    /** Retries HTTP 404 responses, used right after creating a project while it propagates. */
    notFoundRetries?: number;
    tls?: TlsOptions;
    /** Only for tests: replaces the fetch implementation. */
    fetch?: FetchLike;
}

export class SonarApiError extends Error {
    constructor(
        public readonly status: number,
        public readonly method: string,
        public readonly path: string,
        public readonly details: string
    ) {
        super(`${method} ${path} failed with HTTP ${status}${details ? `: ${details}` : ""}`);
        this.name = "SonarApiError";
    }
}

/**
 * Builds the query/body parameters. Arrays are sent as repeated parameters
 * (e.g. values=a&values=b), which is what the Sonar Web API expects for multi-value fields.
 */
export function toSearchParams(params: Params = {}): URLSearchParams {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
            value.forEach(v => search.append(key, v));
        } else {
            search.append(key, String(value));
        }
    }
    return search;
}

function isRetryable(status: number): boolean {
    return status === 429 || status >= 500;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const TLS_ERROR_CODES = new Set([
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "UNABLE_TO_GET_ISSUER_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID"
]);

/** Returns the TLS error code of a failed fetch (the code lives in `cause`), if any. */
export function tlsErrorCode(err: unknown): string | undefined {
    let current: any = err;
    for (let depth = 0; current && depth < 5; depth++) {
        if (typeof current.code === "string" && TLS_ERROR_CODES.has(current.code)) return current.code;
        current = current.cause;
    }
    return undefined;
}

/**
 * The TLS settings only apply to the requests of this client, never to the whole process
 * (unlike NODE_TLS_REJECT_UNAUTHORIZED). undici's own fetch is used together with its Agent
 * because the fetch bundled in Node may not accept an Agent from another undici version.
 */
export function createFetch(tls: TlsOptions = {}): FetchLike {
    if (!tls.insecure && !tls.caCertificatePath) return (url, init) => fetch(url, init);
    const ca = tls.caCertificatePath ? fs.readFileSync(tls.caCertificatePath, "utf8") : undefined;
    const dispatcher = new Agent({ connect: { rejectUnauthorized: !tls.insecure, ...(ca ? { ca } : {}) } });
    return (url, init) => undiciFetch(url, { ...(init as any), dispatcher }) as unknown as Promise<Response>;
}

export class SonarClient {
    readonly baseUrl: string;
    private readonly authorization: string;
    private readonly timeoutMs: number;
    private readonly retries: number;
    private readonly retryDelayMs: number;
    private readonly notFoundRetries: number;
    private readonly fetchImpl: FetchLike;

    constructor(baseUrl: string, private readonly token: string, private readonly options: ClientOptions = {}) {
        if (!baseUrl) throw new Error("The SonarQube server URL is empty.");
        this.baseUrl = baseUrl.replace(/\/+$/, "");
        this.authorization = "Basic " + Buffer.from(`${token}:`).toString("base64");
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.retries = options.retries ?? 3;
        this.retryDelayMs = options.retryDelayMs ?? 1000;
        this.notFoundRetries = options.notFoundRetries ?? 0;
        this.fetchImpl = options.fetch ?? createFetch(options.tls);
    }

    /**
     * Right after a project is created some endpoints may answer 404 for a short time
     * (e.g. on clustered servers). This client retries those responses.
     */
    withNotFoundRetries(retries = 4): SonarClient {
        return new SonarClient(this.baseUrl, this.token, { ...this.options, fetch: this.fetchImpl, notFoundRetries: retries });
    }

    async get<T = any>(path: string, params?: Params): Promise<T> {
        const query = toSearchParams(params).toString();
        const response = await this.request("GET", `${path}${query ? `?${query}` : ""}`);
        const text = await response.text();
        return (text ? JSON.parse(text) : {}) as T;
    }

    async post<T = any>(path: string, params?: Params): Promise<T | undefined> {
        const response = await this.request("POST", path, toSearchParams(params).toString(), "application/x-www-form-urlencoded");
        const text = await response.text();
        return text ? (JSON.parse(text) as T) : undefined;
    }

    private async request(method: "GET" | "POST", path: string, body?: string, contentType?: string): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        let attempt = 0;
        let notFoundAttempt = 0;
        for (;;) {
            attempt++;
            tl.debug(`${method} ${url} (attempt ${attempt})`);
            let response: Response;
            try {
                response = await this.fetchImpl(url, {
                    method,
                    headers: {
                        "Authorization": this.authorization,
                        "Accept": "application/json",
                        ...(contentType ? { "Content-Type": contentType } : {})
                    },
                    body,
                    signal: AbortSignal.timeout(this.timeoutMs)
                });
            } catch (err) {
                const tlsCode = tlsErrorCode(err);
                if (tlsCode) {
                    // Retrying does not fix a certificate problem.
                    throw new SonarApiError(0, method, path,
                        `TLS error ${tlsCode}. If the server uses a self-signed or internal certificate, set 'CA certificate' ` +
                        `(or the NODE_EXTRA_CA_CERTS variable) or, as a last resort, enable 'Allow insecure SSL'.`);
                }
                if (attempt <= this.retries) {
                    tl.debug(`Network error on ${method} ${path}: ${err}. Retrying...`);
                    await sleep(this.retryDelayMs * 2 ** (attempt - 1));
                    continue;
                }
                const cause = (err as { cause?: { message?: string } }).cause?.message;
                throw new SonarApiError(0, method, path, `${(err as Error).message}${cause ? ` (${cause})` : ""}`);
            }

            if (response.ok) return response;

            if (isRetryable(response.status) && attempt <= this.retries) {
                const retryAfter = Number(response.headers.get("retry-after"));
                const delay = retryAfter > 0 ? retryAfter * 1000 : this.retryDelayMs * 2 ** (attempt - 1);
                tl.debug(`HTTP ${response.status} on ${method} ${path}. Retrying in ${delay}ms...`);
                await sleep(delay);
                continue;
            }
            if (response.status === 404 && notFoundAttempt < this.notFoundRetries) {
                notFoundAttempt++;
                attempt--;
                const delay = this.retryDelayMs * 2 ** notFoundAttempt;
                tl.debug(`HTTP 404 on ${method} ${path}, the project may still be propagating. Retrying in ${delay}ms...`);
                await sleep(delay);
                continue;
            }
            throw new SonarApiError(response.status, method, path, await extractErrorDetails(response));
        }
    }
}

async function extractErrorDetails(response: Response): Promise<string> {
    const text = await response.text().catch(() => "");
    try {
        const json = JSON.parse(text);
        if (Array.isArray(json.errors)) {
            return json.errors.map((e: { msg?: string }) => e.msg?.replace(/\s+/g, " ").trim()).filter(Boolean).join("; ");
        }
        // Web API v2 error format.
        if (typeof json.message === "string") return json.message.replace(/\s+/g, " ").trim();
    } catch {
        // Not JSON, fall through to the raw text.
    }
    return text.slice(0, 500);
}

export function isAuthError(err: unknown): boolean {
    return err instanceof SonarApiError && (err.status === 401 || err.status === 403);
}

export function isNotFound(err: unknown): boolean {
    return err instanceof SonarApiError && err.status === 404;
}
