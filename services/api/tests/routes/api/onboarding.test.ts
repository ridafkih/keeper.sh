import { beforeAll, describe, expect, it, vi } from "vitest";
import type { OnboardingStatus } from "@keeper.sh/data-schemas";
import type {
  OnboardingDependencies,
  handleGetOnboardingRoute as handleGetOnboardingRouteFn,
  handlePatchOnboardingRoute as handlePatchOnboardingRouteFn,
} from "../../../src/routes/api/onboarding";

let handleGetOnboardingRoute: typeof handleGetOnboardingRouteFn = () =>
  Promise.reject(new Error("Module not loaded"));
let handlePatchOnboardingRoute: typeof handlePatchOnboardingRouteFn = () =>
  Promise.reject(new Error("Module not loaded"));

vi.mock("../../../src/utils/middleware", () => ({
  withAuth: (handler: unknown) => handler,
  withWideEvent: (handler: unknown) => handler,
}));
vi.mock("../../../src/context", () => ({ database: {} }));

beforeAll(async () => {
  ({ handleGetOnboardingRoute, handlePatchOnboardingRoute } = await import("../../../src/routes/api/onboarding"));
});

const makeDependencies = (status: OnboardingStatus | null, syncCount = 0) => {
  const writes: OnboardingStatus[] = [];
  const dependencies: OnboardingDependencies = {
    getStatus: () => Promise.resolve(status),
    getSyncCount: () => Promise.resolve(syncCount),
    setStatus: (_userId, next) => {
      writes.push(next);
      return Promise.resolve();
    },
  };
  return { dependencies, writes };
};

const onboardingCookie = (response: Response): string | undefined =>
  response.headers.getSetCookie().find((cookie) => cookie.startsWith("keeper.onboarding="));

describe("GET /api/onboarding", () => {
  it("reports a new user as pending and tells the web app to redirect", async () => {
    const { dependencies, writes } = makeDependencies("pending");
    const response = await handleGetOnboardingRoute({ userId: "user-1" }, dependencies);

    expect(await response.json()).toEqual({ status: "pending" });
    expect(onboardingCookie(response)).toBe("keeper.onboarding=pending; Path=/; SameSite=Lax");
    expect(writes).toEqual([]);
  });

  it("records a pending user who already has a sync as completed", async () => {
    const { dependencies, writes } = makeDependencies("pending", 1);
    const response = await handleGetOnboardingRoute({ userId: "user-1" }, dependencies);

    expect(await response.json()).toEqual({ status: "completed" });
    expect(onboardingCookie(response)).toBe("keeper.onboarding=done; Path=/; SameSite=Lax");
    expect(writes).toEqual(["completed"]);
  });

  it("treats skipped as done", async () => {
    const { dependencies } = makeDependencies("skipped");
    const response = await handleGetOnboardingRoute({ userId: "user-1" }, dependencies);

    expect(await response.json()).toEqual({ status: "skipped" });
    expect(onboardingCookie(response)).toContain("keeper.onboarding=done");
  });

  it("returns not found when the user row is gone", async () => {
    const { dependencies } = makeDependencies(null);
    const response = await handleGetOnboardingRoute({ userId: "user-1" }, dependencies);

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/onboarding", () => {
  it("records a skip", async () => {
    const { dependencies, writes } = makeDependencies("pending");
    const response = await handlePatchOnboardingRoute({ body: { status: "skipped" }, userId: "user-1" }, dependencies);

    expect(await response.json()).toEqual({ status: "skipped" });
    expect(onboardingCookie(response)).toContain("keeper.onboarding=done");
    expect(writes).toEqual(["skipped"]);
  });

  it("refuses to put someone back into onboarding", async () => {
    const { dependencies, writes } = makeDependencies("completed");
    const response = await handlePatchOnboardingRoute({ body: { status: "pending" }, userId: "user-1" }, dependencies);

    expect(response.status).toBe(400);
    expect(writes).toEqual([]);
  });
});
