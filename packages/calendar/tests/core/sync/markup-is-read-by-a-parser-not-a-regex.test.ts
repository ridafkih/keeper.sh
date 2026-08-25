import { describe, expect, it } from "vitest";
import { DomHandler, DomUtils, Parser } from "htmlparser2";

/*
 * The shape CodeQL flagged: a single pass that removes `<...>` rejoins whatever surrounded it.
 * Kept here as the thing we must never go back to, so the parser below has something to beat.
 */
const SINGLE_PASS_STRIP = /<\/?[a-zA-Z][^<>]*>/g;

const readMarkupText = (markup: string): string => {
  const handler = new DomHandler();
  new Parser(handler, { decodeEntities: false }).end(markup);

  return DomUtils.textContent(handler.dom);
};

const NESTED_TAG = "<scr<script>ipt>alert(1)</script>";

describe("markup is read by a parser, not a regex", () => {
  it("shows why the single pass was unsound: removing the inner tag builds a new one", () => {
    expect(NESTED_TAG.replaceAll(SINGLE_PASS_STRIP, "")).toContain("<script>");
  });

  it("leaves no element behind when the tokenizer reads it", () => {
    expect(readMarkupText(NESTED_TAG)).not.toContain("<script>");
  });

  it("recovers the text a destination wrapped in markup", () => {
    expect(readMarkupText("<html><body><p>Quarterly review</p></body></html>"))
      .toBe("Quarterly review");
  });

  it("leaves an angle bracket that was never markup alone", () => {
    expect(readMarkupText("capacity < 40 people")).toBe("capacity < 40 people");
  });

  it("leaves entities for the decode step rather than resolving them twice", () => {
    expect(readMarkupText("<p>a &amp;lt; b</p>")).toBe("a &amp;lt; b");
  });
});
