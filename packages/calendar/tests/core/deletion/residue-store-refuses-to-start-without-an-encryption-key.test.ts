import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { describe, expect, it } from "vitest";
import { createTeardownResidueStore } from "../../../src/core/deletion/teardown-residue-store";

const client = new PGlite();
const database = drizzle(client);

const ENCRYPTION_KEY = "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=";
const NOW = new Date("2026-08-26T06:15:33.956Z");
const MISSING_KEY_MESSAGE =
  "Teardown residue holds provider credentials and cannot be read or written without ENCRYPTION_KEY";

describe("residue store refuses to start without an encryption key", () => {
  it("throws at construction when ENCRYPTION_KEY is absent", () => {
    expect(() =>
      createTeardownResidueStore({
        database,
        encryptionKey: null,
        now: () => NOW,
      }),
    ).toThrowError(MISSING_KEY_MESSAGE);
  });

  it("constructs when ENCRYPTION_KEY is present", () => {
    expect(() =>
      createTeardownResidueStore({
        database,
        encryptionKey: ENCRYPTION_KEY,
        now: () => NOW,
      }),
    ).not.toThrow();
  });
});
