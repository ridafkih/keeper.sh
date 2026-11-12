import { describe, expect, it } from "vitest";
import {
  pagePathForMarkdown,
  prefersMarkdown,
  toMarkdownDocument,
  withAbsoluteLinks,
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

describe("withAbsoluteLinks", () => {
  it("makes root-relative links and images absolute", () => {
    expect(withAbsoluteLinks("See [pricing](/pricing) and ![panel](/product/panel.png).")).toBe(
      "See [pricing](https://www.keeper.sh/pricing) and ![panel](https://www.keeper.sh/product/panel.png).",
    );
  });

  it("makes reference definitions absolute", () => {
    expect(withAbsoluteLinks("[Docs][docs]\n\n[docs]: /docs")).toBe("[Docs][docs]\n\n[docs]: https://www.keeper.sh/docs");
  });

  it("leaves code, external links and authored markup as written", () => {
    const content = [
      "| Tool | Link |",
      "|---|---|",
      "| Keeper.sh | [repo](https://github.com/ridafkih/keeper.sh) |",
      "",
      "`[inline](/code)`",
      "",
      "```md",
      "[block](/code)",
      "```",
      "",
      '<faq-item question="Is it free?">Yes, for two accounts.</faq-item>',
      "",
      "[protocol-relative](//example.com/x)",
    ].join("\n");

    expect(withAbsoluteLinks(content)).toBe(content);
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
