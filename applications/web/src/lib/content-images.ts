import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { imageSize } from "image-size";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export interface ContentImageFile {
  file: string;
  height: number;
  urlEnd: number;
  urlStart: number;
  width: number;
}

const CONTENT_IMAGE_EXTENSIONS = new Set([".avif", ".jpeg", ".jpg", ".png", ".webp"]);
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const HTML_IMAGE = /<img\b/i;
const CONTENT_IMAGE_PLACEHOLDER = /__contentImage(\d+)__/g;

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function isInside(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path.length > 0 && !path.startsWith("..") && !isAbsolute(path);
}

function locateUrl(content: string, start: number, end: number, url: string): number {
  const offset = content.slice(start, end).lastIndexOf(`](${url}`);
  return offset === -1 ? -1 : start + offset + 2;
}

function resolveImageFile(url: string, sourceFile: string, contentRoot: string): string {
  if (URL_SCHEME.test(url) || url.startsWith("/")) {
    throw new Error(
      `"${sourceFile}" links the image "${url}". Store the image in the seo repository and link it with a relative path.`,
    );
  }

  const file = resolve(dirname(sourceFile), decodeURIComponent(url));

  if (!isInside(contentRoot, file)) {
    throw new Error(`"${sourceFile}" links the image "${url}", which is outside the seo repository.`);
  }

  if (!CONTENT_IMAGE_EXTENSIONS.has(extname(file).toLowerCase())) {
    throw new Error(
      `"${sourceFile}" links the image "${url}". Use one of ${[...CONTENT_IMAGE_EXTENSIONS].join(", ")}.`,
    );
  }

  if (!existsSync(file)) {
    throw new Error(`"${sourceFile}" links the image "${url}", which does not exist.`);
  }

  return file;
}

function measure(file: string, sourceFile: string): { height: number; width: number } {
  const { height, width } = imageSize(readFileSync(file));

  if (!width || !height) {
    throw new Error(`"${sourceFile}" links the image "${file}", whose size cannot be read.`);
  }

  return { height, width };
}

export function collectContentImages(
  content: string,
  sourceFile: string,
  contentRoot: string,
): ContentImageFile[] {
  const tree = markdownParser.parse(content);
  const images: ContentImageFile[] = [];

  visit(tree, (node) => {
    if (node.type === "html" && HTML_IMAGE.test(node.value)) {
      throw new Error(`"${sourceFile}" has an HTML <img>. Use markdown image syntax: ![Alt text](path).`);
    }

    if (node.type === "imageReference") {
      throw new Error(`"${sourceFile}" has a reference-style image. Use inline syntax: ![Alt text](path).`);
    }

    if (node.type !== "image") return;

    if (!node.alt?.trim()) {
      throw new Error(`"${sourceFile}" links the image "${node.url}" without alt text.`);
    }

    const file = resolveImageFile(node.url, sourceFile, contentRoot);
    const urlStart = locateUrl(
      content,
      node.position?.start.offset ?? 0,
      node.position?.end.offset ?? content.length,
      node.url,
    );

    if (urlStart === -1) {
      throw new Error(`"${sourceFile}" links the image "${node.url}" with escapes. Write the path plainly.`);
    }

    images.push({ ...measure(file, sourceFile), file, urlEnd: urlStart + node.url.length, urlStart });
  });

  return images;
}

export function replaceContentImageUrls(
  content: string,
  images: ContentImageFile[],
  urlFor: (index: number) => string,
): string {
  return images.reduceRight(
    (rewritten, image, index) =>
      `${rewritten.slice(0, image.urlStart)}${urlFor(index)}${rewritten.slice(image.urlEnd)}`,
    content,
  );
}

export function renderContentCollectionModule<Entry extends { content: string; images: ContentImageFile[] }>(
  exportName: string,
  entries: Entry[],
): string {
  const imageFiles: string[] = [];

  const exported = entries.map(({ images, ...entry }) => {
    const placeholders = images.map((image) => {
      imageFiles.push(image.file);
      return `__contentImage${imageFiles.length - 1}__`;
    });

    return {
      ...entry,
      content: replaceContentImageUrls(entry.content, images, (index) => placeholders[index]),
      images: images.map(({ height, width }, index) => ({ height, src: placeholders[index], width })),
    };
  });

  const imports = imageFiles.map(
    (file, index) => `import contentImage${index} from ${JSON.stringify(file)};`,
  );
  const body = JSON.stringify(exported).replace(CONTENT_IMAGE_PLACEHOLDER, '" + contentImage$1 + "');

  return [...imports, `export const ${exportName} = ${body};`].join("\n");
}
