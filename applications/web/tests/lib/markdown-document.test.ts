import { describe, expect, it } from "vitest";
import {
  cleanMdxContent,
  pagePathForMarkdown,
  prefersMarkdown,
  toMarkdownDocument,
} from "../../src/lib/markdown-document";

describe("prefersMarkdown", () => {
  it("prefers markdown when it is the only type asked for", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
  });

  it("prefers markdown when it outranks HTML", () => {
    expect(prefersMarkdown("text/markdown, text/html;q=0.9")).toBe(true);
  });

  it("keeps HTML for browsers", () => {
    expect(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(false);
  });

  it("keeps HTML when markdown is ranked lower", () => {
    expect(prefersMarkdown("text/html, text/markdown;q=0.5")).toBe(false);
  });

  it("keeps HTML for wildcards and missing headers", () => {
    expect(prefersMarkdown("*/*")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });

  it("ignores markdown that is explicitly refused", () => {
    expect(prefersMarkdown("text/markdown;q=0")).toBe(false);
  });
});

describe("markdown paths", () => {
  it("maps a .md path to its page path", () => {
    expect(pagePathForMarkdown("/docs/plans-and-limits.md")).toBe("/docs/plans-and-limits");
  });

  it("ignores paths that are not markdown", () => {
    expect(pagePathForMarkdown("/docs/plans-and-limits")).toBeNull();
    expect(pagePathForMarkdown("/.md")).toBeNull();
  });
});

describe("cleanMdxContent", () => {
  it("turns FAQ components into headings", () => {
    const content = [
      "## FAQ",
      "",
      "<faq>",
      '<faq-item question="Is it free?">Yes, for two accounts.</faq-item>',
      "</faq>",
    ].join("\n");

    expect(cleanMdxContent(content)).toBe("## FAQ\n\n### Is it free?\n\nYes, for two accounts.");
  });

  it("drops MDX import and export lines", () => {
    expect(cleanMdxContent('import Thing from "./thing";\n\nBody text.')).toBe("Body text.");
  });

  it("makes root-relative links absolute", () => {
    expect(cleanMdxContent("See [pricing](/pricing).")).toBe("See [pricing](https://www.keeper.sh/pricing).");
  });

  it("keeps headings and code blocks intact", () => {
    const content = "## Setup\n\n```bash\ncurl https://www.keeper.sh/api/v1\n```";
    expect(cleanMdxContent(content)).toBe(content);
  });
});

describe("toMarkdownDocument", () => {
  const document = toMarkdownDocument({
    content: "Body text.",
    description: "What each plan includes.",
    path: "/docs/plans-and-limits",
    title: "Plans and limits",
    updatedAt: "2026-10-01",
  });

  it("leads with the title and description", () => {
    expect(document.startsWith("# Plans and limits\n\n> What each plan includes.\n\nBody text.")).toBe(true);
  });

  it("ends with where to report errors", () => {
    expect(document).toContain("Source: https://www.keeper.sh/docs/plans-and-limits (last updated 2026-10-01)");
    expect(document).toContain(
      "https://github.com/ridafkih/keeper.sh/issues/new?title=Content+error+on+%2Fdocs%2Fplans-and-limits",
    );
  });
});
