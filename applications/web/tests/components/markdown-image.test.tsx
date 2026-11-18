import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContentImagesContext } from "@/components/ui/primitives/content-images-context";
import { MarkdownImage } from "@/components/ui/primitives/markdown-image";
import { Prose } from "@/components/ui/primitives/prose";

describe("MarkdownImage", () => {
  it("renders a known content image lazily at its own size", () => {
    const markup = renderToStaticMarkup(
      <ContentImagesContext value={[{ height: 450, src: "/assets/form.png", width: 800 }]}>
        <MarkdownImage alt="The new app password form" src="/assets/form.png" />
      </ContentImagesContext>,
    );

    expect(markup).toContain('alt="The new app password form"');
    expect(markup).toContain('width="800"');
    expect(markup).toContain('height="450"');
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
  });

  it("renders an unknown image lazily without a size", () => {
    const markup = renderToStaticMarkup(<MarkdownImage alt="Elsewhere" src="/assets/other.png" />);

    expect(markup).toContain('loading="lazy"');
    expect(markup).not.toContain("width=");
  });
});

describe("Prose images", () => {
  it("gives a markdown image in content its build size", () => {
    const markup = renderToStaticMarkup(
      <Prose images={[{ height: 450, src: "/assets/form-Cz1j4IJ8.png", width: 800 }]}>
        {"Open settings.\n\n![The new app password form](/assets/form-Cz1j4IJ8.png)\n"}
      </Prose>,
    );

    expect(markup).toMatch(/<img[^>]*src="\/assets\/form-Cz1j4IJ8\.png"[^>]*>/);
    expect(markup).toContain('width="800"');
    expect(markup).toContain('height="450"');
    expect(markup).toContain('loading="lazy"');
  });
});
