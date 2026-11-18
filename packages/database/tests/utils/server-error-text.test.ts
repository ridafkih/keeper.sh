import { describe, expect, it } from "vitest";
import {
  loggedServerContext,
  loggedServerDetail,
  loggedServerMessage,
} from "../../src/utils/server-error-text";

describe("loggedServerMessage", () => {
  it.each([
    ["22P02", 'invalid input syntax for type integer: "4111 1111"', "invalid input syntax for type integer"],
    ["22P02", 'invalid input value for enum provider: "ada@example.com"', "invalid input value for enum provider"],
    ["22007", 'invalid input syntax for type timestamp with time zone: "soon"', "invalid input syntax for type timestamp with time zone"],
    ["22008", 'date/time field value out of range: "2026-13-45"', "date/time field value out of range"],
    ["22003", 'value "99999999999" is out of range for type integer', "value is out of range for type integer"],
    ["22023", 'invalid value for parameter "TimeZone": "ada\'s "home" zone"', "invalid value for parameter"],
    ["22023", 'time zone "ada@example.com" not recognized', "time zone not recognized"],
    ["22P02", 'invalid input syntax for type integer: "4111 1111', "invalid input syntax for type integer"],
    ["22021", 'invalid byte sequence for encoding "UTF8": 0xe9 0x61', "invalid byte sequence for encoding"],
  ])("keeps only the condition of a %s data exception", (sqlState, message, expected) => {
    expect(loggedServerMessage(sqlState, message)).toBe(expected);
  });

  it.each([
    ["22001", "value too long for type character varying(255)"],
    ["22003", "integer out of range"],
    ["23505", 'duplicate key value violates unique constraint "user_email_unique"'],
    ["23502", 'null value in column "email" of relation "user" violates not-null constraint'],
    ["42601", 'syntax error at or near "selec"'],
    ["42P01", 'relation "calendars" does not exist'],
    ["57014", "canceling statement due to statement timeout"],
  ])("leaves a %s message as the server wrote it", (sqlState, message) => {
    expect(loggedServerMessage(sqlState, message)).toBe(message);
  });

  it("leaves a driver message that carries no SQLSTATE as it is", () => {
    expect(loggedServerMessage(null, "Connection closed")).toBe("Connection closed");
  });
});

describe("loggedServerDetail", () => {
  it.each([
    ["23505", "Key (email)=(ada@example.com) already exists.", "Key (email)"],
    ["23505", "Key (lower(email))=(ada@example.com) already exists.", "Key (lower(email))"],
    [
      "23505",
      "Key (calendar_id, source_event_uid)=(4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77, ada@example.com) already exists.",
      "Key (calendar_id, source_event_uid)",
    ],
    ["23503", 'Key (url)=(https://ada:pw@example.com/a)b) is not present in table "feeds".', "Key (url)"],
    ["23P01", "Key (room, during)=(a, [1,2)) conflicts with existing key (room, during)=(a, [1,3)).", "Key (room, during)"],
  ])("names the key columns of a %s violation without their values", (sqlState, detail, expected) => {
    expect(loggedServerDetail(sqlState, detail)).toBe(expected);
  });

  it("keeps a key made only of internal identifiers", () => {
    const detail =
      'Key (event_id)=(00000000-0000-0000-0000-000000000000) is not present in table "events".';

    expect(loggedServerDetail("23503", detail)).toBe(detail);
  });

  it("keeps a composite key made only of internal identifiers", () => {
    const detail =
      "Key (source_id, destination_id)=(4f0c1a9e-6b0f-4b7e-9a51-0d6d2c1f3e77, 0d6d2c1f-9a51-4b7e-6b0f-4f0c1a9e3e77) already exists.";

    expect(loggedServerDetail("23505", detail)).toBe(detail);
  });

  it.each([
    ["23502", "Failing row contains (3, ada@example.com, null)."],
    ["23514", "Failing row contains (3, Dentist, -1)."],
    ["22P02", 'Token "ada" is invalid.'],
    ["P0001", "ada@example.com is not allowed"],
    [null, "ada@example.com"],
  ])("drops a %s detail that quotes row contents", (sqlState, detail) => {
    expect(loggedServerDetail(sqlState, detail)).toBeNull();
  });

  it.each([
    ["40P01", "Process 4821 waits for ShareLock on transaction 9120; blocked by process 4822."],
    ["40001", "Reason code: Canceled on identification as a pivot, during write."],
    ["57P01", "The connection was closed by an administrator."],
  ])("keeps a %s detail that describes server state", (sqlState, detail) => {
    expect(loggedServerDetail(sqlState, detail)).toBe(detail);
  });

  it("gives the same answer when applied to its own output", () => {
    const once = loggedServerDetail("23505", "Key (email)=(ada@example.com) already exists.");

    expect(loggedServerDetail("23505", once as string)).toBe(once);
  });
});

describe("loggedServerContext", () => {
  it("drops the context of a failure that quotes a parameter", () => {
    expect(loggedServerContext("22P02", "unnamed portal parameter $1 = 'ada@example.com'")).toBeNull();
  });

  it("keeps the context of a lock failure", () => {
    const context = 'while updating tuple (0,5) in relation "event_states"';

    expect(loggedServerContext("40P01", context)).toBe(context);
  });
});
