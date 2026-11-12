import fetchMock from "jest-fetch-mock";
import { SonarClient } from "../libs/client";
import { StepContext } from "../libs/step";

export interface RecordedCall {
    method: string;
    host: string;
    path: string;
    params: URLSearchParams;
    body: string;
}

type Handler = (call: RecordedCall) => { status?: number; body?: unknown } | undefined;

/**
 * Routes mocked fetch calls by "METHOD /path". Unrouted GETs return 404 and unrouted POSTs return 204.
 */
export function mockSonar(routes: Record<string, Handler | { status?: number; body?: unknown }>): RecordedCall[] {
    const calls: RecordedCall[] = [];
    fetchMock.mockResponse(async req => {
        const url = new URL(req.url);
        const body = req.method === "POST" ? await req.text() : "";
        const params = req.method === "POST" ? new URLSearchParams(body) : url.searchParams;
        const call = { method: req.method, host: url.host, path: url.pathname, params, body };
        calls.push(call);
        const route = routes[`${req.method} ${url.pathname}`];
        const result = typeof route === "function" ? route(call) : route;
        if (!result) {
            return req.method === "POST" ? { status: 204 } : { status: 404, body: JSON.stringify({ errors: [{ msg: "Not found" }] }) };
        }
        return {
            status: result.status ?? 200,
            body: result.body === undefined ? "" : JSON.stringify(result.body)
        };
    });
    return calls;
}

export function posts(calls: RecordedCall[], path?: string): RecordedCall[] {
    return calls.filter(c => c.method === "POST" && (!path || c.path === path));
}

export function newClient(): SonarClient {
    return new SonarClient("https://sonar.example.com/", "token", { retries: 2, retryDelayMs: 0, timeoutMs: 1000 });
}

export function newContext(dryRun = false): StepContext {
    return new StepContext(newClient(), "my-project", dryRun);
}
