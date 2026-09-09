import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  imported: vi.fn(), consume: vi.fn(), session: vi.fn(),
  fetch: vi.fn(), rows: [] as Record<string, unknown>[],
}));
vi.mock("@/utils/middleware", () => ({ withAuth: (handler: unknown) => handler, withWideEvent: (handler: unknown) => handler }));
vi.mock("@/utils/graph-oauth-session", () => ({ withAuthorizedGraphSession: state.session, removeGraphSession: state.consume }));
vi.mock("@/utils/oauth-sources", () => ({ importOAuthAccountCalendars: state.imported }));
vi.mock("@keeper.sh/calendar/safe-fetch", () => ({ createSafeFetch: () => state.fetch }));
vi.mock("@/utils/safe-fetch-options", () => ({ safeFetchOptions: {} }));
vi.mock("@/context", () => ({ database: { select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(state.rows) }) }) }) } }));
const { POST: rawPost } = await import("@/routes/api/sources/graph");
const post = rawPost as unknown as (context: { userId: string; request: Request }) => Promise<Response>;
const call = (body: object) => post({ userId: "owner", request: new Request("https://keeper.test/api/sources/graph", {
  method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
}) } as never);
beforeEach(() => {
  vi.clearAllMocks(); state.rows = [];
  state.fetch.mockResolvedValue(Response.json({ id: "microsoft-user", mail: "person@example.test" }));
  state.session.mockImplementation((_user, _id, action) => action({
    config: { auth: { scope: "openid profile offline_access", accessToken: "server-access", refreshToken: "server-refresh", expiresAt: Date.now() + 3_600_000 } },
    connection: { clientId: "11111111-1111-4111-8111-111111111111", tenant: "organizations" },
  }));
  state.imported.mockResolvedValue("account");
});
describe("Graph connection", () => {
  it("persists the server-authorized Client ID, imports calendars and consumes the session", async () => {
    const response = await call({ sessionId: "session", config: { clientId: "attacker" } });
    expect(response.status).toBe(201);
    expect(state.imported).toHaveBeenCalledWith(expect.objectContaining({ userId: "owner" }), expect.objectContaining({ microsoftClientId: "11111111-1111-4111-8111-111111111111", microsoftTenant: "organizations", microsoftScope: "openid profile offline_access", provider: "outlook" }));
    expect(state.imported).toHaveBeenCalledWith(expect.objectContaining({ providerAccountId: "microsoft-user" }), expect.any(Object));
    expect(state.consume).toHaveBeenCalledWith("owner", "session");
    expect(await response.text()).not.toContain("server-access");
  });
  it("retains the authorization session when the atomic import fails", async () => {
    state.imported.mockRejectedValueOnce(new Error("Import failed"));
    const response = await call({ sessionId: "session" });
    expect(response.status).toBe(400);
    expect(state.consume).not.toHaveBeenCalled();
  });
  it("requires the server-held authorization session", async () => {
    const response = await call({ accessToken: "injected" });
    expect(response.status).toBe(400);
    expect(state.imported).not.toHaveBeenCalled();
  });
  it("refuses to reconnect an account not owned by this Keeper user", async () => {
    const response = await call({ sessionId: "session", accountId: "foreign" });
    expect(response.status).toBe(400);
    expect(state.imported).not.toHaveBeenCalled();
  });
  it("does not save tokens when Graph profile lookup fails", async () => {
    state.fetch.mockResolvedValue(new Response("private details", { status: 403 }));
    const response = await call({ sessionId: "session" });
    expect(response.status).toBe(400);
    expect(state.imported).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain("private details");
  });
});
