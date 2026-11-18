import { describe, expect, it } from "vitest";
import { withLoggedText } from "../src/tracing/logged-wide-events";

const ADDRESS = ["ada.lovelace", "example.com"].join("@");

interface Write {
  method: string;
  values: unknown[];
}

const createWriter = () => {
  const writes: Write[] = [];
  const record = (method: string) => (...values: unknown[]): void => {
    writes.push({ method, values });
  };
  return {
    writer: {
      append: record("append") as (key: string, value: boolean | number | string) => void,
      count: record("count") as (key: string, amount?: number) => void,
      errorFields: record("errorFields") as (error: unknown, options?: { slug?: string }) => void,
      flush: record("flush") as () => void,
      set: record("set") as (key: string, value: boolean | number | string) => void,
      setFields: record("setFields") as (fields: Record<string, unknown>) => void,
    },
    writes,
  };
};

describe("a wide-event writer that records logged text", () => {
  it("applies the text rule to a field it sets", () => {
    const { writer, writes } = createWriter();

    withLoggedText(writer).set("provider.error", `Calendar ${ADDRESS} not found`);

    expect(writes).toEqual([{ method: "set", values: ["provider.error", "Calendar [email] not found"] }]);
  });

  it("applies the text rule to a value it appends", () => {
    const { writer, writes } = createWriter();

    withLoggedText(writer).append(
      "sync.error_samples",
      `[create] https://caldav.example.com/dav/${ADDRESS}/event.ics refused`,
    );

    expect(writes).toEqual([{
      method: "append",
      values: ["sync.error_samples", "[create] https://caldav.example.com/[path] refused"],
    }]);
  });

  it("applies the text rule to every string in a set of fields", () => {
    const { writer, writes } = createWriter();

    withLoggedText(writer).setFields({ auth: { log: `error: ${ADDRESS} rejected` }, attempts: 2 });

    expect(writes).toEqual([{
      method: "setFields",
      values: [{ auth: { log: "error: [email] rejected" }, attempts: 2 }],
    }]);
  });

  it("records an error by the logged form of its message and passes the options on", () => {
    const { writer, writes } = createWriter();

    withLoggedText(writer).errorFields(
      new TypeError(`Token refresh failed (400): {"user":"${ADDRESS}"}`),
      { slug: "provider-auth-failed" },
    );

    const [write] = writes;
    const [error, options] = write?.values ?? [];
    expect(write?.method).toBe("errorFields");
    expect((error as Error).name).toBe("TypeError");
    expect((error as Error).message).toBe('Token refresh failed (400): {"user":"[email]"}');
    expect(String((error as Error).stack)).not.toContain(ADDRESS);
    expect(options).toEqual({ slug: "provider-auth-failed" });
  });

  it("leaves numbers, flags and identifiers as written", () => {
    const { writer, writes } = createWriter();
    const logged = withLoggedText(writer);

    logged.set("user.id", "4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77");
    logged.set("events.added", 3);
    logged.set("flushed", true);

    expect(writes.map(({ values }) => values[1])).toEqual([
      "4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77",
      3,
      true,
    ]);
  });

  it("passes every other method through to the writer", () => {
    const { writer, writes } = createWriter();
    const logged = withLoggedText(writer);

    logged.count("events.seen", 2);
    logged.flush();

    expect(writes).toEqual([
      { method: "count", values: ["events.seen", 2] },
      { method: "flush", values: [] },
    ]);
  });
});
