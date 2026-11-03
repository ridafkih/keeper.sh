import { beforeEach, describe, expect, it, vi } from "vitest";

let values: Record<string, unknown> = {};
let errorSlug: unknown = null;

vi.mock("@/utils/logging", () => ({
  widelog: {
    errorFields: (_error: unknown, options: { slug?: string }) => {
      errorSlug = options.slug;
    },
    set: (key: string, value: unknown) => {
      values = { ...values, [key]: value };
    },
  },
}));

const { handlePostIcsSourceRoute } = await import("@/routes/api/ics/source-routes");

class TestInvalidSourceUrlError extends Error {
  public readonly authRequired = false;
  public readonly reason = "not_ical";
}

beforeEach(() => {
  values = {};
  errorSlug = null;
});

describe("an ICS link Keeper.sh could not use", () => {
  const submit = () =>
    handlePostIcsSourceRoute(
      { body: { name: "Feed", url: "https://example.com/page" }, userId: "user-1" },
      {
        createSource: () => Promise.reject(new TestInvalidSourceUrlError("not an ics file")),
        isInvalidSourceUrlError: (error): error is TestInvalidSourceUrlError =>
          error instanceof TestInvalidSourceUrlError,
        isSourceLimitError: () => false,
        parseCreateSourceBody: () => ({ name: "Feed", url: "https://example.com/page" }),
      },
    );

  it("records why the link was rejected", async () => {
    const response = await submit();

    expect(response.status).toBe(400);
    expect(errorSlug).toBe("invalid-source-url");
    expect(values["source.invalid_reason"]).toBe("not_ical");
  });

  it("never records the link itself", async () => {
    await submit();

    expect(JSON.stringify(values)).not.toContain("example.com");
  });
});
