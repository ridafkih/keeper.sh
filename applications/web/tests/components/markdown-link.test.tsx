import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownLink } from "@/components/ui/primitives/markdown-components";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children: ReactNode }) => (
    <a data-router-link="" href={to} {...props}>
      {children}
    </a>
  ),
}));

const render = (href: string): string =>
  renderToStaticMarkup(<MarkdownLink href={href}>link</MarkdownLink>);

describe("MarkdownLink", () => {
  it("routes an absolute link to the canonical site host client-side", () => {
    const markup = render("https://www.keeper.sh/register");

    expect(markup).toContain("data-router-link");
    expect(markup).toContain('href="/register"');
    expect(markup).not.toContain("_blank");
    expect(markup).not.toContain("noreferrer");
  });

  it("routes an absolute link to the apex site host client-side", () => {
    const markup = render("https://keeper.sh/blog");

    expect(markup).toContain("data-router-link");
    expect(markup).toContain('href="/blog"');
  });

  it("keeps the query and hash of an absolute site link", () => {
    const markup = render("https://www.keeper.sh/blog?page=2#faq");

    expect(markup).toContain('href="/blog?page=2#faq"');
  });

  it("routes a root-relative link client-side", () => {
    const markup = render("/register");

    expect(markup).toContain("data-router-link");
    expect(markup).toContain('href="/register"');
  });

  it("opens a third-party link in a new tab", () => {
    const markup = render("https://onecal.io");

    expect(markup).not.toContain("data-router-link");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("leaves an in-page anchor as a plain link", () => {
    const markup = render("#faq");

    expect(markup).not.toContain("data-router-link");
    expect(markup).not.toContain("_blank");
    expect(markup).toContain('href="#faq"');
  });

  it("leaves a mailto link as a plain link", () => {
    const markup = render("mailto:support@keeper.sh");

    expect(markup).not.toContain("data-router-link");
    expect(markup).not.toContain("_blank");
  });
});
