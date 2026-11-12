import { beforeAll, describe, expect, it, vi } from "vitest";
import type {
  AccountSettings,
  AccountSettingsStore,
  handleGetAccountSettings as handleGetFn,
  handlePatchAccountSettings as handlePatchFn,
} from "../../../../src/routes/api/account/settings";

vi.mock("../../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../../src/utils/logging", () => ({
  widelog: { set: vi.fn() },
}));
vi.mock("../../../../src/context", () => ({ database: {} }));

let handleGet: typeof handleGetFn = () => Promise.reject(new Error("Module not loaded"));
let handlePatch: typeof handlePatchFn = () => Promise.reject(new Error("Module not loaded"));

beforeAll(async () => {
  ({
    handleGetAccountSettings: handleGet,
    handlePatchAccountSettings: handlePatch,
  } = await import("../../../../src/routes/api/account/settings"));
});

const createStore = (initial: Record<string, AccountSettings>) => {
  const settings = new Map(Object.entries(initial));
  const writes: [string, AccountSettings][] = [];
  const store: AccountSettingsStore = {
    read: (userId) => Promise.resolve(settings.get(userId) ?? null),
    write: (userId, update) => {
      writes.push([userId, update]);
      if (!settings.has(userId)) {
        return Promise.resolve(null);
      }
      settings.set(userId, update);
      return Promise.resolve(update);
    },
  };
  return { store, writes };
};

describe("account settings", () => {
  it("reports whether agent feedback is on for the user", async () => {
    const { store } = createStore({ "user-1": { agentFeedbackEnabled: true } });

    const response = await handleGet("user-1", store);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agentFeedbackEnabled: true });
  });

  it("lets the user opt out of agent feedback", async () => {
    const { store, writes } = createStore({ "user-1": { agentFeedbackEnabled: true } });

    const response = await handlePatch("user-1", { agentFeedbackEnabled: false }, store);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ agentFeedbackEnabled: false });
    expect(writes).toEqual([["user-1", { agentFeedbackEnabled: false }]]);
  });

  it("lets the user opt back in", async () => {
    const { store } = createStore({ "user-1": { agentFeedbackEnabled: false } });

    const response = await handlePatch("user-1", { agentFeedbackEnabled: true }, store);

    expect(await response.json()).toEqual({ agentFeedbackEnabled: true });
  });

  it.each([
    ["a non-boolean value", { agentFeedbackEnabled: "no" }],
    ["an unknown field", { agentFeedbackEnabled: false, email: "person@example.com" }],
    ["an empty body", {}],
    ["no body", null],
  ])("rejects %s without writing", async (_label, body) => {
    const { store, writes } = createStore({ "user-1": { agentFeedbackEnabled: true } });

    const response = await handlePatch("user-1", body, store);

    expect(response.status).toBe(400);
    expect(writes).toHaveLength(0);
  });

  it("answers not found for a user that no longer exists", async () => {
    const { store } = createStore({});

    const readResponse = await handleGet("gone", store);
    const writeResponse = await handlePatch("gone", { agentFeedbackEnabled: false }, store);

    expect(readResponse.status).toBe(404);
    expect(writeResponse.status).toBe(404);
  });
});
