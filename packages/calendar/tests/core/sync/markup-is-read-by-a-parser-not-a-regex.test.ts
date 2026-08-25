import { describe, expect, it } from "vitest";
import { DomHandler, DomUtils, Parser } from "htmlparser2";

/*
 * This decode used to strip markup by removing every `<...>` in a single pass. That is unsound:
 * removing an inner tag rejoins whatever surrounded it, so `<scr` + `<script>` + `ipt>` comes back
 * out as a live `<script>`. The regex is not reproduced here even to demonstrate it -- keeping an
 * unsound pattern in the tree only teaches a scanner to flag us again.
 *
 * The damage is a correctness one before it is a security one: this decode exists to ask whether a
 * remote value is our own text in the destination's storage form, and a mis-decode answers yes to
 * a stranger's edit and adopts it as the baseline.
 */
const readMarkupText = (markup: string): string => {
  const handler = new DomHandler();
  new Parser(handler, { decodeEntities: false }).end(markup);

  return DomUtils.textContent(handler.dom);
};

describe("markup is read by a parser, not a regex", () => {
  it("leaves no element behind when a tag is nested inside a broken one", () => {
    expect(readMarkupText("<scr<script>ipt>alert(1)</script>")).not.toContain("<script>");
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
