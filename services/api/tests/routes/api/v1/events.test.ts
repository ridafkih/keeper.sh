import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { POST as POSTfn } from "@/routes/api/v1/events/index";

const mockCreateEvent = vi.fn();

let POST: typeof POSTfn = () => Promise.reject(new Error("Module not loaded"));

const makeRequest = (body: unknown) =>
  new Request("http://localhost/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const readJson = (response: Response): Promise<{ error?: string; id?: string }> =>
  response.json() as Promise<{ error?: string; id?: string }>;

const validBody = {
  calendarId: "cal-1",
  title: "Test event",
  startTime: "2026-09-03T10:30:00+02:00",
  endTime: "2026-09-03T11:00:00+02:00",
};

beforeAll(async () => {
  vi.mock("@/utils/middleware", () => ({
    withWideEvent: (handler: unknown) => handler,
    withV1Auth: (handler: unknown) => handler,
  }));
  vi.mock("@/read-models", () => ({
    createKeeperApi: () => ({ createEvent: mockCreateEvent }),
  }));
  vi.mock("@/context", () => ({
    database: {},
    oauthProviders: {},
    refreshLockStore: {},
    encryptionKey: "test-key",
  }));

  ({ POST } = await import("@/routes/api/v1/events/index"));
});

beforeEach(() => {
  mockCreateEvent.mockReset();
});

describe("POST /api/v1/events error mapping (MA-451/MA-423)", () => {
  it("returns 201 with the created event on success", async () => {
    mockCreateEvent.mockResolvedValueOnce({ success: true, event: { id: "evt-1" } });

    const response = await POST({ request: makeRequest(validBody), userId: "user-1" });

    expect(response.status).toBe(201);
    expect(await readJson(response)).toEqual({ id: "evt-1" });
  });

  it("returns 400 for a body that fails arktype validation (createEvent not called)", async () => {
    const response = await POST({
      request: makeRequest({ calendarId: "cal-1", title: "no times" }),
      userId: "user-1",
    });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain("Invalid event data");
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed (non-JSON) body", async () => {
    const response = await POST({ request: makeRequest("not json{"), userId: "user-1" });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toContain("valid JSON");
    expect(mockCreateEvent).not.toHaveBeenCalled();
  });

  it("maps an OAuth reauth-required throw to 401, NOT a generic 400", async () => {
    mockCreateEvent.mockRejectedValueOnce(
      Object.assign(new Error("Token has been expired or revoked"), {
        oauthReauthRequired: true,
      }),
    );

    const response = await POST({ request: makeRequest(validBody), userId: "user-1" });

    expect(response.status).toBe(401);
    expect((await readJson(response)).error).toContain("reauthentication");
  });

  it("maps an invalid_grant message throw to 401", async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error("refresh failed: invalid_grant"));

    const response = await POST({ request: makeRequest(validBody), userId: "user-1" });

    expect(response.status).toBe(401);
  });

  it("maps a generic operational throw to 500 with the real message", async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error("provider exploded"));

    const response = await POST({ request: makeRequest(validBody), userId: "user-1" });

    expect(response.status).toBe(500);
    expect((await readJson(response)).error).toBe("provider exploded");
  });

  it("returns 400 when createEvent reports a domain failure", async () => {
    mockCreateEvent.mockResolvedValueOnce({ success: false, error: "Calendar not found" });

    const response = await POST({ request: makeRequest(validBody), userId: "user-1" });

    expect(response.status).toBe(400);
    expect((await readJson(response)).error).toBe("Calendar not found");
  });
});
