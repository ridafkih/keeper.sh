import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { hasImportedLogin, type DraftStorage } from "../../../src/features/setup/setup-draft-storage";
import {
  readImportedAccountIds,
  runLoginImport,
  useLoginImport,
  type LoginImportRequest,
} from "../../../src/features/setup/use-login-import";
import { mountHook, type MountedHook } from "../../helpers/mount-hook";

vi.mock("../../../src/hooks/use-session", () => ({
  useSession: () => ({ user: { id: "user-a" } }),
}));

const createStorage = (): DraftStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    removeItem: (key) => { map.delete(key); },
    setItem: (key, value) => { map.set(key, value); },
  };
};

const settle = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

describe("runLoginImport", () => {
  it("marks the import done only after the server answers", async () => {
    const storage = createStorage();
    let answer: (value: unknown) => void = () => null;
    const pending = runLoginImport(storage, "user-a", () => new Promise((resolve) => { answer = resolve; }));

    expect(hasImportedLogin(storage, "user-a")).toBe(false);
    answer({ accountIds: ["account-1"] });
    await expect(pending).resolves.toEqual(["account-1"]);
    expect(hasImportedLogin(storage, "user-a")).toBe(true);
  });

  it("leaves the flag unset when the request fails, so it can be retried", async () => {
    const storage = createStorage();
    await expect(runLoginImport(storage, "user-a", () => Promise.reject(new Error("503")))).rejects.toThrow("503");
    expect(hasImportedLogin(storage, "user-a")).toBe(false);
  });

  it("treats a server that declines as done, with nothing imported", () => {
    expect(readImportedAccountIds({ imported: false })).toEqual([]);
    expect(readImportedAccountIds({ accountIds: ["a", 3, "b"] })).toEqual(["a", "b"]);
    expect(readImportedAccountIds(null)).toEqual([]);
  });
});

describe("useLoginImport", () => {
  let mounted: MountedHook<ReturnType<typeof useLoginImport>> | null = null;

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  const mount = (request: LoginImportRequest, onImported: (accountId: string) => void, enabled = true) => {
    mounted = mountHook(() => useLoginImport(enabled, onImported, request));
    return mounted;
  };

  it("shows the import while it runs, then hands over the new calendars", async () => {
    const onImported = vi.fn();
    let answer: (value: unknown) => void = () => null;
    const hook = mount(() => new Promise((resolve) => { answer = resolve; }), onImported);

    expect(hook.latest().status).toBe("importing");
    answer({ accountIds: ["account-1"] });
    await settle();

    expect(onImported).toHaveBeenCalledWith("account-1");
    expect(hook.latest().status).toBe("done");
  });

  it("doesn't refresh anything when the server imported nothing", async () => {
    const onImported = vi.fn();
    const hook = mount(() => Promise.resolve({ imported: false }), onImported);
    await settle();

    expect(onImported).not.toHaveBeenCalled();
    expect(hook.latest().status).toBe("done");
  });

  it("reports a failure and runs again on retry", async () => {
    const onImported = vi.fn();
    const request = vi.fn<LoginImportRequest>()
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ accountIds: ["account-1"] });
    const hook = mount(request, onImported);
    await settle();
    expect(hook.latest().status).toBe("failed");

    act(() => hook.latest().retry());
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
    expect(onImported).toHaveBeenCalledTimes(1);
    expect(hook.latest().status).toBe("done");
  });

  it("does nothing until it's enabled", () => {
    const request = vi.fn<LoginImportRequest>();
    const hook = mount(request, () => null, false);
    expect(request).not.toHaveBeenCalled();
    expect(hook.latest().status).toBe("idle");
  });
});
