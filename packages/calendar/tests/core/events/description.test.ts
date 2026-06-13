import { describe, expect, it } from "vitest";
import { derivePlaintextDescription, parseDescriptionFields } from "../../../src/core/events/description";

describe("derivePlaintextDescription", () => {
  it("derives readable text with anchor URLs from HTML", () => {
    const result = derivePlaintextDescription(
      '<div>Join <a href="https://example.com/meet">meeting</a><br>Bring notes</div>',
    );

    expect(result).toEqual({
      plaintextDescription: "Join meeting (https://example.com/meet)\nBring notes",
    });
  });

  it("uses the URL directly when anchor text matches the href", () => {
    const result = derivePlaintextDescription(
      '<a href="https://example.com/meet">https://example.com/meet</a>',
    );

    expect(result).toEqual({
      plaintextDescription: "https://example.com/meet",
    });
  });
});

describe("parseDescriptionFields", () => {
  it("keeps the canonical description and derives plaintext only for HTML-ish content", () => {
    const result = parseDescriptionFields("<p>Hello <strong>there</strong></p>");

    expect(result).toEqual({
      description: "<p>Hello <strong>there</strong></p>",
      plaintextDescription: "Hello there",
    });
  });

  it("keeps plain text descriptions unchanged without adding a derived field", () => {
    const result = parseDescriptionFields("Hello there");

    expect(result).toEqual({ description: "Hello there" });
  });
});
