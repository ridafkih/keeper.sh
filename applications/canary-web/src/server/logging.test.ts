import { describe, expect, it } from "bun:test";
import { normalizeOperationPath } from "./logging";

describe("normalizeOperationPath", () => {
  it("normalizes UUID path segments", () => {
    expect(normalizeOperationPath("/api/accounts/24750098-9575-4bc8-8830-5d1b3adb2240")).toBe(
      "/api/accounts/:id",
    );
  });

  it("normalizes numeric path segments", () => {
    expect(normalizeOperationPath("/api/accounts/12345")).toBe("/api/accounts/:id");
  });

  it("normalizes /api/cal identifier segments", () => {
    expect(normalizeOperationPath("/api/cal/my-calendar-id")).toBe("/api/cal/:id");
  });

  it("collapses all assets paths to /assets/:asset", () => {
    expect(normalizeOperationPath("/assets/auth-switch-pro-A1B2C3.js")).toBe("/assets/:asset");
    expect(normalizeOperationPath("/assets/chunks/runtime/main.js")).toBe("/assets/:asset");
  });

  it("keeps static routes unchanged", () => {
    expect(normalizeOperationPath("/api/socket/url")).toBe("/api/socket/url");
    expect(normalizeOperationPath("/dashboard")).toBe("/dashboard");
  });
});
