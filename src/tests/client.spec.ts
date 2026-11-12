import fetchMock from "jest-fetch-mock";
import { SonarApiError, SonarClient, createFetch, isAuthError, tlsErrorCode, toSearchParams } from "../libs/client";
import { mockSonar, newClient } from "./helpers";

describe("SonarClient", () => {
    beforeEach(() => fetchMock.resetMocks());

    test("encodes special characters and repeats array parameters", () => {
        const params = toSearchParams({ name: "Front Angular & API", regex: "(main|release)-.+#1", values: ["a", "b"], skip: undefined });
        expect(params.toString()).toBe("name=Front+Angular+%26+API&regex=%28main%7Crelease%29-.%2B%231&values=a&values=b");
    });

    test("sends POST parameters as a form-encoded body with basic auth", async () => {
        const calls = mockSonar({});
        await newClient().post("/api/projects/create", { name: "My Project", project: "key" });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("https://sonar.example.com/api/projects/create");
        expect((init!.headers as Record<string, string>)["Authorization"]).toBe("Basic " + Buffer.from("token:").toString("base64"));
        expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
        expect(calls[0].params.get("name")).toBe("My Project");
    });

    test("retries on 5xx and 429 responses", async () => {
        fetchMock.mockResponses(
            ["", { status: 503 }],
            ["", { status: 429 }],
            [JSON.stringify({ ok: true }), { status: 200 }]
        );
        await expect(newClient().get("/api/x")).resolves.toEqual({ ok: true });
        expect(fetchMock.mock.calls.length).toBe(3);
    });

    test("gives up after the configured retries", async () => {
        fetchMock.mockResponse("", { status: 500 });
        await expect(newClient().get("/api/x")).rejects.toThrow("HTTP 500");
        expect(fetchMock.mock.calls.length).toBe(3);
    });

    test("retries network errors", async () => {
        fetchMock.mockRejectOnce(new Error("ECONNRESET")).mockResponseOnce(JSON.stringify({ ok: 1 }));
        await expect(newClient().get("/api/x")).resolves.toEqual({ ok: 1 });
    });

    test("does not retry client errors and extracts the Sonar error messages", async () => {
        fetchMock.mockResponse(JSON.stringify({ errors: [{ msg: "Insufficient privileges" }] }), { status: 403 });
        const error = await newClient().post("/api/x").catch(e => e);
        expect(error).toBeInstanceOf(SonarApiError);
        expect(error.status).toBe(403);
        expect(error.message).toContain("Insufficient privileges");
        expect(isAuthError(error)).toBe(true);
        expect(fetchMock.mock.calls.length).toBe(1);
    });

    test("retries 404 responses only when configured for a newly created project", async () => {
        fetchMock.mockResponses(["", { status: 404 }], ["", { status: 404 }], new Response(null, { status: 204 }));
        await expect(newClient().withNotFoundRetries(2).post("/api/settings/set")).resolves.toBeUndefined();
        expect(fetchMock.mock.calls.length).toBe(3);

        fetchMock.resetMocks();
        fetchMock.mockResponse(JSON.stringify({ errors: [{ msg: "Project doesn't exist" }] }), { status: 404 });
        await expect(newClient().withNotFoundRetries(2).post("/api/x")).rejects.toThrow("Project doesn't exist");
        expect(fetchMock.mock.calls.length).toBe(3);

        fetchMock.resetMocks();
        fetchMock.mockResponse("", { status: 404 });
        await expect(newClient().post("/api/x")).rejects.toThrow("HTTP 404");
        expect(fetchMock.mock.calls.length).toBe(1);
    });

    test("requires the server URL and trims trailing slashes", () => {
        expect(() => new SonarClient("", "t")).toThrow(/URL is empty/);
        expect(new SonarClient("https://sonar.example.com/sonarqube//", "t").baseUrl).toBe("https://sonar.example.com/sonarqube");
    });

    test("does not retry TLS errors and explains how to fix them", async () => {
        const tlsError = Object.assign(new TypeError("fetch failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" } });
        fetchMock.mockReject(tlsError);
        await expect(newClient().get("/api/x")).rejects.toThrow(/TLS error SELF_SIGNED_CERT_IN_CHAIN.*CA certificate/);
        expect(fetchMock.mock.calls.length).toBe(1);
        expect(tlsErrorCode(new Error("other"))).toBeUndefined();
    });

    test("uses the global fetch unless TLS options are given", async () => {
        mockSonar({ "GET /api/x": { body: { ok: true } } });
        await expect(new SonarClient("https://sonar.example.com", "t", { retries: 0, fetch: createFetch({}) }).get("/api/x")).resolves.toEqual({ ok: true });
        expect(fetchMock.mock.calls.length).toBe(1);
        expect(createFetch({ insecure: true })).not.toBe(createFetch({}));
    });

    test("returns undefined for empty POST responses", async () => {
        fetchMock.mockResponse(new Response(null, { status: 204 }));
        await expect(newClient().post("/api/x")).resolves.toBeUndefined();
    });
});
