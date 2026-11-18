import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { context, widelog } from "../../src/utils/logging";

const ADDRESS = ["ada.lovelace", "example.com"].join("@");

const emitted: Record<string, unknown>[] = [];
const originalWrite = process.stdout.write.bind(process.stdout);

beforeEach(() => {
  emitted.length = 0;
  process.stdout.write = ((chunk: unknown) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim().length > 0) {
        emitted.push(JSON.parse(line) as Record<string, unknown>);
      }
    }
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

const emit = (record: () => void): Record<string, unknown> => {
  context(() => {
    record();
    widelog.flush();
  });
  const [event] = emitted;
  if (!event) {
    throw new Error("no wide event was emitted");
  }
  return event;
};

describe("the wide event the cron service writes", () => {
  it("records a provider's words without the address or URL detail they quote", () => {
    const event = emit(() => {
      widelog.set("operation.name", "ingest-source");
      widelog.set("provider.resources_skipped_reasons", `/dav/${ADDRESS}/a.ics: unreadable`);
      widelog.append("sync.error_samples", `PUT https://caldav.example.com/dav/${ADDRESS}/a.ics failed`);
      widelog.setFields({ reauth: { previous_read_error: `mailbox ${ADDRESS} is inactive` } });
      widelog.errorFields(
        new Error(`Failed to fetch events: 404: {"calendar":"${ADDRESS}"}`),
        { slug: "provider-calendar-not-found" },
      );
    });

    expect(event).toMatchObject({
      error: {
        error_message: 'Failed to fetch events: 404: {"calendar":"[email]"}',
        error_name: "Error",
        slug: "provider-calendar-not-found",
      },
      operation: { name: "ingest-source" },
      provider: { resources_skipped_reasons: "/dav/[email]/a.ics: unreadable" },
      reauth: { previous_read_error: "mailbox [email] is inactive" },
      sync: { error_samples: ["PUT https://caldav.example.com/[path] failed"] },
    });
    expect(JSON.stringify(event)).not.toContain(ADDRESS);
  });

  it("keeps identifiers, counts and a failed statement as written", () => {
    const statement = 'Failed query: select "id" from "calendars" where "tags" @> $1';

    const event = emit(() => {
      widelog.set("provider.calendar_id", "4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77");
      widelog.set("events.added", 3);
      widelog.errorFields(new Error(statement), { slug: "db-query-failed" });
    });

    expect(event).toMatchObject({
      error: { error_message: statement, slug: "db-query-failed" },
      events: { added: 3 },
      provider: { calendar_id: "4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77" },
    });
  });
});
