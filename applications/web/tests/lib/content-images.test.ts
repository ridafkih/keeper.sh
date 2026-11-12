import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectContentImages,
  renderContentCollectionModule,
  replaceContentImageUrls,
} from "../../src/lib/content-images";

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

let contentRoot: string;
let sourceFile: string;

beforeEach(() => {
  contentRoot = mkdtempSync(join(tmpdir(), "content-images-"));
  mkdirSync(join(contentRoot, "guides"));
  mkdirSync(join(contentRoot, "assets"));
  writeFileSync(join(contentRoot, "assets", "app-password.png"), pngHeader(800, 450));
  sourceFile = join(contentRoot, "guides", "connect.mdx");
});

afterEach(() => {
  rmSync(contentRoot, { force: true, recursive: true });
});

const collect = (content: string) => collectContentImages(content, sourceFile, contentRoot);

describe("collectContentImages", () => {
  it("measures an image stored in the seo repository", () => {
    const content = "Open settings.\n\n![The new app password form](../assets/app-password.png)\n";

    expect(collect(content)).toEqual([
      {
        file: join(contentRoot, "assets", "app-password.png"),
        height: 450,
        urlEnd: content.indexOf(")", content.indexOf("../assets")),
        urlStart: content.indexOf("../assets"),
        width: 800,
      },
    ]);
  });

  it("returns nothing for content without images", () => {
    expect(collect("Just text with a [link](/blog).")).toEqual([]);
  });

  it("ignores image syntax inside code blocks", () => {
    expect(collect("```md\n![](../assets/missing.png)\n```\n")).toEqual([]);
  });

  it("fails when alt text is missing", () => {
    expect(() => collect("![](../assets/app-password.png)")).toThrow("without alt text");
  });

  it("fails when alt text is only whitespace", () => {
    expect(() => collect("![   ](../assets/app-password.png)")).toThrow("without alt text");
  });

  it("fails when the image file does not exist", () => {
    expect(() => collect("![A missing screenshot](../assets/missing.png)")).toThrow("does not exist");
  });

  it("fails on a remote image", () => {
    expect(() => collect("![A remote image](https://example.com/a.png)")).toThrow("relative path");
  });

  it("fails on a root-relative image", () => {
    expect(() => collect("![A public image](/integrations/a.png)")).toThrow("relative path");
  });

  it("fails on an image outside the seo repository", () => {
    expect(() => collect("![Outside](../../outside.png)")).toThrow("outside the seo repository");
  });

  it("fails on an unsupported format", () => {
    writeFileSync(join(contentRoot, "assets", "diagram.svg"), "<svg/>");
    expect(() => collect("![A diagram](../assets/diagram.svg)")).toThrow("Use one of");
  });

  it("fails on an HTML image", () => {
    expect(() => collect('<img src="../assets/app-password.png" alt="Form" />')).toThrow("markdown image syntax");
  });

  it("fails on a reference-style image", () => {
    expect(() => collect("![Form][form]\n\n[form]: ../assets/app-password.png")).toThrow("inline syntax");
  });
});

describe("replaceContentImageUrls", () => {
  it("swaps each image path and leaves the rest of the content alone", () => {
    const content = "![One](../assets/app-password.png) and ![Two](../assets/app-password.png \"Title\")";
    const images = collect(content);

    expect(replaceContentImageUrls(content, images, (index: number) => `/assets/${index}.png`)).toBe(
      "![One](/assets/0.png) and ![Two](/assets/1.png \"Title\")",
    );
  });
});

describe("renderContentCollectionModule", () => {
  it("imports each image so the bundler serves it, and exports its size", () => {
    const content = "![The new app password form](../assets/app-password.png)";
    const post = { content, images: collect(content), slug: "connect" };

    const module = renderContentCollectionModule("guidesPages", [post]);

    expect(module).toContain(
      `import contentImage0 from ${JSON.stringify(join(contentRoot, "assets", "app-password.png"))};`,
    );
    expect(module).toContain('"content":"![The new app password form](" + contentImage0 + ")"');
    expect(module).toContain('"images":[{"height":450,"src":"" + contentImage0 + "","width":800}]');
    expect(module).not.toContain(contentRoot.concat("/guides"));
  });
});
