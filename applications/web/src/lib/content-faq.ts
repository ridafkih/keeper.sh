import type { Element, ElementContent, Root, RootContent } from "hast";
import { toString } from "hast-util-to-string";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

export interface ContentFaqEntry {
  answer: string;
  question: string;
}

const FAQ_SECTION_TITLES = new Set(["faq", "frequently asked questions"]);
const FAQ_SECTION_TITLE_PREFIX = "common questions";

const htmlProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw);

function toHtmlTree(content: string): Root {
  return htmlProcessor.runSync(htmlProcessor.parse(content));
}

function isElement(node: RootContent | ElementContent, tagName: string): node is Element {
  return node.type === "element" && node.tagName === tagName;
}

function isFaqSectionHeading(node: RootContent): boolean {
  if (!isElement(node, "h2")) return false;
  const title = toString(node).trim().toLowerCase();
  return FAQ_SECTION_TITLES.has(title) || title.startsWith(FAQ_SECTION_TITLE_PREFIX);
}

function blockText(nodes: RootContent[]): string {
  return nodes
    .map((node) => toString(node).trim())
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function faqItems(tree: Root): ContentFaqEntry[] {
  const entries: ContentFaqEntry[] = [];
  visit(tree, "element", (node) => {
    if (node.tagName !== "faq-item") return;
    entries.push({ answer: toString(node).trim(), question: String(node.properties.question ?? "").trim() });
  });
  return entries;
}

function faqSection(tree: Root): ContentFaqEntry[] {
  const start = tree.children.findIndex(isFaqSectionHeading);
  if (start === -1) return [];

  const rest = tree.children.slice(start + 1);
  const end = rest.findIndex((node) => isElement(node, "h2"));
  const section = end === -1 ? rest : rest.slice(0, end);

  const entries: Array<{ question: string; answer: RootContent[] }> = [];
  for (const node of section) {
    if (isElement(node, "h3")) {
      entries.push({ answer: [], question: toString(node).trim() });
    } else {
      entries[entries.length - 1]?.answer.push(node);
    }
  }

  return entries.map(({ answer, question }) => ({ answer: blockText(answer), question }));
}

export function extractContentFaq(content: string): ContentFaqEntry[] {
  const tree = toHtmlTree(content);
  const items = faqItems(tree);
  return items.length > 0 ? items : faqSection(tree);
}
