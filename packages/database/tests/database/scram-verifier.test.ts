import { describe, expect, it } from "vitest";
import { buildScramVerifier } from "../../src/database/scram-verifier";

const SALT = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");

describe("SCRAM verifier", () => {
  it("derives the verifier PostgreSQL stores for a password and salt", () => {
    expect(buildScramVerifier("pencil", SALT)).toBe(
      "SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=",
    );
  });

  it("salts each verifier differently and never embeds the password", () => {
    const first = buildScramVerifier("correct-horse-battery");
    const second = buildScramVerifier("correct-horse-battery");

    expect(first).not.toBe(second);
    expect(first).not.toContain("correct-horse-battery");
  });

  it("refuses a password whose stored form depends on normalization", () => {
    expect(() => buildScramVerifier("pass word")).toThrow();
    expect(() => buildScramVerifier("pässword")).toThrow();
    expect(() => buildScramVerifier("")).toThrow();
  });
});
