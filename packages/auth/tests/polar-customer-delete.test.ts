import { describe, expect, it, vi } from "vitest";
import { deletePolarCustomerByExternalId } from "../src/polar-customer-delete";

describe("deletePolarCustomerByExternalId", () => {
  it("ignores ResourceNotFound responses from Polar", async () => {
    const resourceNotFoundError = Object.assign(new Error("Not found"), {
      detail: "Not found",
      error: "ResourceNotFound",
    });
    const deleteExternal = vi.fn(() => Promise.reject(resourceNotFoundError));

    await expect(
      deletePolarCustomerByExternalId(
        { customers: { deleteExternal } },
        "user-1",
      ),
    ).resolves.toBeUndefined();

    expect(deleteExternal).toHaveBeenCalledTimes(1);
    expect(deleteExternal).toHaveBeenCalledWith({ externalId: "user-1" });
  });

  it("propagates an unexpected Polar failure instead of orphaning the customer", async () => {
    const deleteExternal = vi.fn(() => Promise.reject(new Error("polar unavailable")));

    await expect(
      deletePolarCustomerByExternalId(
        { customers: { deleteExternal } },
        "user-1",
      ),
    ).rejects.toThrow("polar unavailable");
  });

  it("reports an unexpected failure by rejecting rather than by writing to stderr", async () => {
    const deleteExternal = vi.fn(() => Promise.reject(new Error("polar unavailable")));
    const stderrWrite = vi.fn(() => true);
    const originalNodeEnv = process.env.NODE_ENV;
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.env.NODE_ENV = "production";
    process.stderr.write = stderrWrite;

    try {
      await expect(
        deletePolarCustomerByExternalId(
          { customers: { deleteExternal } },
          "user-1",
        ),
      ).rejects.toThrow("polar unavailable");

      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.stderr.write = originalStderrWrite;
    }
  });
});
