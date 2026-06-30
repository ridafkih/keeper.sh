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

  it("preserves meaningful line breaks in partial HTML fragments", () => {
    const result = derivePlaintextDescription(
      'Line one\n<a href="https://example.com/meet">Join call</a>\nLine three',
    );

    expect(result).toEqual({
      plaintextDescription: "Line one\nJoin call (https://example.com/meet)\nLine three",
    });
  });

  it("normalizes br and block elements as line breaks", () => {
    const withBreaks = derivePlaintextDescription(
      'Line one<br><a href="https://example.com/meet">Join call</a><br>Line three',
    );
    const withBlocks = derivePlaintextDescription(
      '<p>Line one</p><p><a href="https://example.com/meet">Join call</a></p><p>Line three</p>',
    );

    expect(withBreaks).toEqual({
      plaintextDescription: "Line one\nJoin call (https://example.com/meet)\nLine three",
    });
    expect(withBlocks).toEqual({
      plaintextDescription: "Line one\nJoin call (https://example.com/meet)\nLine three",
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
