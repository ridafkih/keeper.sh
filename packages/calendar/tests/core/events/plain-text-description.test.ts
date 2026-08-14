import { describe, expect, it } from "vitest";
import { toPlainTextDescription } from "../../../src/core/events/plain-text-description";

const MEET_BLOCK = [
  "-::~:~::~:~:~:~:~:~:~:~:~:~:~::~:~::-",
  "Join with Google Meet: https://meet.google.com/abc-defg-hij",
  "Or dial: (US) +1 555-555-5555 PIN: 123456789#",
  "More phone numbers: https://tel.meet/abc-defg-hij?pin=1234567890123",
  "",
  "Please do not edit this section.",
  "-::~:~::~:~:~:~:~:~:~:~:~:~:~::~:~::-",
].join("\n");

const SPAN_WRAPPED_MEET_BLOCK = `<span style="white-space:pre">${MEET_BLOCK}</span>`;

const OUTLOOK_BODY = [
  "<html><head>",
  "<meta http-equiv=\"Content-Type\" content=\"text/html; charset=utf-8\">",
  "<style type=\"text/css\">p.MsoNormal {margin:0in; font-size:11.0pt}</style>",
  "</head><body lang=\"EN-US\"><div class=\"WordSection1\">",
  "<p class=\"MsoNormal\">Hi team &amp; friends</p>",
  "<p class=\"MsoNormal\"><a href=\"https://teams.microsoft.com/l/x?a=1&amp;b=2\">Join</a></p>",
  "</div></body></html>",
].join("");

const HOSTILE_MARKUP_BUDGET_MS = 2000;

const project = (value: string): string => toPlainTextDescription(value) ?? "";

describe("toPlainTextDescription", () => {
  it("unwraps a Meet block a source stored inside a styled span", () => {
    expect(project(SPAN_WRAPPED_MEET_BLOCK)).toBe(MEET_BLOCK);
  });

  it("keeps an angle-bracketed plain-text URL, which is not a tag", () => {
    const value = "Dial in: <https://tel.meet/x?pin=1&hs=2>";

    expect(project(value)).toBe(value);
  });

  it("keeps every word when a stray angle bracket precedes a real tag", () => {
    const value = "Compare <div with <span> tags";

    expect(project(value)).toContain("div with");
    expect(project(value)).toBe(value);
  });

  it("leaves a description that carries no markup exactly as its author typed it", () => {
    const value = "A &amp; B, budget <= 5, see <notes>";

    expect(project(value)).toBe(value);
  });

  it("reads a paragraph as a blank line and a break as a single line", () => {
    expect(project("<p>Agenda</p><p>Bring the deck<br>and a laptop</p>"))
      .toBe("Agenda\n\nBring the deck\nand a laptop");
  });

  it("drops head, style and script without leaking their source", () => {
    const projected = project(OUTLOOK_BODY);

    expect(projected).not.toContain("MsoNormal");
    expect(projected).not.toContain("font-size");
    expect(projected).toBe("Hi team & friends\n\nJoin (https://teams.microsoft.com/l/x?a=1&b=2)");
  });

  it("keeps a bare link once, without repeating it as its own label", () => {
    expect(project("<p><a href=\"https://meet.google.com/abc\">https://meet.google.com/abc</a></p>"))
      .toBe("https://meet.google.com/abc");
  });

  it("keeps a link once when its label is the destination without scheme or trailing slash", () => {
    expect(project("<p><a href=\"https://meet.google.com/abc\">meet.google.com/abc</a></p>"))
      .toBe("meet.google.com/abc");
    expect(project("<p><a href=\"https://x.test/\">https://x.test</a></p>")).toBe("https://x.test");
  });

  it("reads a list as a line each and a table row as its cells", () => {
    const value = "<p>Agenda</p><ul><li>Budget</li><li>Hiring</li></ul>"
      + "<table><tr><td>Q3</td><td>Done</td></tr></table>";

    expect(project(value)).toBe("Agenda\n\nBudget\nHiring\n\nQ3  Done");
  });

  it("keeps every word an author escaped, including the tags they wrote about", () => {
    expect(project("<p>Set &lt;timeout&gt;30&lt;/timeout&gt; in the config</p>"))
      .toBe("Set <timeout>30</timeout> in the config");
    expect(project(
      "<p>&lt;html&gt;&lt;head&gt;&lt;title&gt;T&lt;/title&gt;&lt;/head&gt;"
      + "&lt;body&gt;B&lt;/body&gt;&lt;/html&gt;</p>",
    )).toBe("<html><head><title>T</title></head><body>B</body></html>");
  });

  it("keeps an unterminated tag's text instead of swallowing the rest of the value", () => {
    expect(project("Grade a<b or better</blockquote>")).toContain("or better");
    expect(project("<p>Agenda</p><div class=\"x\">Bring the deck")).toContain("Bring the deck");
    expect(project("Agenda <div class=\"x")).toContain("Agenda");
    expect(project("Read the <style>x and the rest")).toContain("and the rest");
  });

  it("keeps prose after an attribute list the parser stops reading part-way through", () => {
    const value = "Bring the deck <p  [=\n'>/ and the laptop";

    expect(project(value)).toContain("Bring the deck");
    expect(project(value)).toContain("and the laptop");
  });

  it("keeps prose an unterminated comment would otherwise swallow", () => {
    expect(project("Notes <!-- and the rest of the agenda")).toContain("rest of the agenda");
    expect(project("<!-- hidden -->visible")).toBe("visible");
  });

  it("keeps prose whose only markup is a discardable element", () => {
    expect(project("Notes <script>the script team</script> owns this"))
      .toBe("Notes the script team owns this");
    expect(project("Use <style>the style guide</style> from design"))
      .toBe("Use the style guide from design");
    expect(project("The <title>Q3 Review</title> deck")).toBe("The Q3 Review deck");
  });

  it("keeps prose whose only markup is one bracketed placeholder with a value", () => {
    const values = [
      "Set the <input type=\"text\"> field to 3",
      "Fill in <field name=\"owner\"> before the call",
      "Bring the <source lang=\"en\"> handout",
    ];

    for (const value of values) {
      expect(project(value)).toBe(value);
    }
  });

  it("reads a placeholder with a value as markup once the document is markup", () => {
    expect(project("<p>Photo: <img src=\"https://x.test/a.png\"></p>")).toBe("Photo:");
  });

  it("does not stall on a long description of nothing but unclosed comment openers", () => {
    const start = performance.now();

    project("<!--".repeat(60_000));

    expect(performance.now() - start).toBeLessThan(HOSTILE_MARKUP_BUDGET_MS);
  });

  it("uncovers one escaped layer and stops, rather than peeling to the last", () => {
    expect(project("<p>&lt;p&gt;&amp;lt;br&amp;gt;&lt;/p&gt;</p>")).toBe("<p>&lt;br&gt;</p>");
  });

  it("returns an absent description as it found it", () => {
    expect(toPlainTextDescription(globalThis.undefined)).toBe(globalThis.undefined);
    expect(toPlainTextDescription("")).toBe("");
  });

  it("still returns a description for malformed, truncated or unpaired-surrogate markup", () => {
    const values = [
      "<div>".repeat(50_000),
      "<p>lone \uD800 surrogate</p>",
      "\uDC00<p>trailing \uDFFF</p>\uD83D",
      "<p>&#xZZZZ; &#; &#999999999999; &notanentity;</p>",
      "<p unterminated",
      "<<<<>>>><p></p>",
      "<p><![CDATA[<b>x</b>]]></p>",
      "<!-- <p>hidden</p> -->visible",
      "<p attr=\"<b>\">x</p>",
      "<a href=",
      "\u0000<p>null byte</p>",
    ];

    for (const value of values) {
      expect(typeof project(value)).toBe("string");
    }
  });

  it("drops a doctype and an XML declaration instead of showing them to the reader", () => {
    expect(project("<!DOCTYPE html><html><body><p>Agenda</p></body></html>")).toBe("Agenda");
    expect(project("<?xml version=\"1.0\"?><p>Agenda</p>")).toBe("Agenda");
  });

  it("keeps a bracketed word that is neither a doctype nor a declaration", () => {
    expect(project("see <!important> note and <p>Agenda</p>"))
      .toBe("see <!important> note and\n\nAgenda");
  });

  it("keeps a pseudo-tag as text inside a document that is real markup", () => {
    expect(project("<p>Set the <input> field to 3</p>")).toBe("Set the <input> field to 3");
    expect(project("<p>Bring the <source> deck<br>and the <link> handout</p>"))
      .toBe("Bring the <source> deck\nand the <link> handout");
  });

  it("keeps the words of a description nested thousands of elements deep, losing only its lines", () => {
    const shallow = "<div>a<br>b</div>";
    const deep = `${"<div>".repeat(1500)}a<br>b${"</div>".repeat(1500)}`;

    expect(project(shallow)).toBe("a\nb");
    expect(project(deep)).toBe("a b");
  });

  it("never deletes a word from prose that looks like markup", () => {
    const values = [
      "Bring the <source> document and the <link> handout",
      "Reply with <name> and <date> please",
      "Set the <input> field to 3",
      "Use a < b and b > c as the bound",
      "x <y z",
    ];

    for (const value of values) {
      const projected = project(value);

      for (const word of value.split(/[\s<>]+/).filter((part) => /^[a-z]+$/i.test(part))) {
        expect(projected).toContain(word);
      }
    }
  });
});
