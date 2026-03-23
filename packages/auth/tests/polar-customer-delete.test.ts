import { describe, expect, it, mock } from "bun:test";
import { deletePolarCustomerByExternalId } from "../src/polar-customer-delete";

describe("deletePolarCustomerByExternalId", () => {
  it("ignores ResourceNotFound responses from Polar", () => {
    const resourceNotFoundError = Object.assign(new Error("Not found"), {
      detail: "Not found",
      error: "ResourceNotFound",
    });
    const deleteExternal = mock(() => Promise.reject(resourceNotFoundError));

    expect(
      deletePolarCustomerByExternalId(
        { customers: { deleteExternal } },
        "user-1",
      ),
    ).resolves.toBeUndefined();

    expect(deleteExternal).toHaveBeenCalledTimes(1);
    expect(deleteExternal).toHaveBeenCalledWith({ externalId: "user-1" });
  });

  it("does not throw when Polar deletion fails unexpectedly", () => {
    const deleteExternal = mock(() => Promise.reject(new Error("polar unavailable")));

    expect(
      deletePolarCustomerByExternalId(
        { customers: { deleteExternal } },
        "user-1",
      ),
    ).resolves.toBeUndefined();
  });

  it("does not write to stderr during tests when deletion fails unexpectedly", () => {
    const deleteExternal = mock(() => Promise.reject(new Error("polar unavailable")));
    const stderrWrite = mock(() => true);
    const originalNodeEnv = process.env.NODE_ENV;
    const originalStderrWrite = process.stderr.write.bind(process.stderr);

    process.env.NODE_ENV = "test";
    process.stderr.write = stderrWrite;

    try {
      expect(
        deletePolarCustomerByExternalId(
          { customers: { deleteExternal } },
          "user-1",
        ),
      ).resolves.toBeUndefined();

      expect(stderrWrite).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      process.stderr.write = originalStderrWrite;
    }
  });
});
