import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MarkdownHeadingOne,
  MarkdownHeadingThree,
  MarkdownHeadingTwo,
} from "@/components/ui/primitives/markdown-components";

const render = (children: ReactNode): string =>
  renderToStaticMarkup(<MarkdownHeadingTwo>{children}</MarkdownHeadingTwo>);

describe("markdown headings", () => {
  it("gives every heading level a linkable id", () => {
    expect(renderToStaticMarkup(<MarkdownHeadingOne>Why sync breaks</MarkdownHeadingOne>))
      .toContain('id="why-sync-breaks"');
    expect(render("Why sync breaks")).toContain('id="why-sync-breaks"');
    expect(renderToStaticMarkup(<MarkdownHeadingThree>Why sync breaks</MarkdownHeadingThree>))
      .toContain('id="why-sync-breaks"');
  });

  it("collapses punctuation and spacing into single separators", () => {
    expect(render("Google Calendar & Outlook: what works?")).toContain(
      'id="google-calendar-outlook-what-works"',
    );
  });

  it("folds accents onto their base letters", () => {
    expect(render("Créer un agenda")).toContain('id="creer-un-agenda"');
  });

  it("reads through inline markup in the heading text", () => {
    expect(render(<>Using <code>ICS</code> feeds</>)).toContain('id="using-ics-feeds"');
  });

  it("omits the id when the heading has no sluggable text", () => {
    expect(render("—")).not.toContain("id=");
  });
});
