import { describe, expect, test } from "vitest";
import { escapeTextValue, quoteParameterValue } from "../../src/index";

describe("RFC 5545 §3.3.11 TEXT escaping on the way out", () => {
  test("a backslash, comma, semicolon and newline are escaped", () => {
    expect(escapeTextValue(`${String.raw`a\b,c;d`}\ne`)).toBe(String.raw`a\\b\,c\;d\ne`);
  });

  test("escaping is applied once, so a re-serialise does not double it", () => {
    const once = escapeTextValue("a,b");

    expect(escapeTextValue(once)).not.toBe(once);
    expect(once).toBe(String.raw`a\,b`);
  });

  test("RFC 5545 §3.2: a parameter value containing a colon is quoted", () => {
    expect(quoteParameterValue("https://example.com/x")).toBe('"https://example.com/x"');
  });

  test("RFC 5545 §3.2: a parameter value with no special characters is not quoted", () => {
    expect(quoteParameterValue("Europe/Berlin")).toBe("Europe/Berlin");
  });

  test("RFC 5545 §3.2: a double quote inside a parameter value is removed rather than smuggled through", () => {
    expect(quoteParameterValue('a"b')).not.toContain('a"b');
  });
});
