import { canonicalUrl } from "./seo";

const MARKDOWN_SUFFIX = ".md";
const MARKDOWN_MEDIA_TYPE = "text/markdown";
const HTML_MEDIA_TYPE = "text/html";
const ISSUES_URL = "https://github.com/ridafkih/keeper.sh/issues/new";

const FAQ_WRAPPER_PATTERN = /^<\/?faq>\s*$/gm;
const FAQ_ITEM_PATTERN = /<faq-item question="([^"]*)">([\s\S]*?)<\/faq-item>/g;
const MDX_MODULE_LINE_PATTERN = /^(?:import|export)\s.*$/gm;
const ROOT_RELATIVE_LINK_PATTERN = /\]\((\/[^)\s]*)\)/g;
const EXCESS_BLANK_LINES_PATTERN = /\n{3,}/g;

export interface MarkdownDocumentSource {
  content: string;
  description: string;
  path: string;
  title: string;
  updatedAt: string;
}

export function pagePathForMarkdown(pathname: string): string | null {
  if (!pathname.endsWith(MARKDOWN_SUFFIX)) return null;
  const pagePath = pathname.slice(0, -MARKDOWN_SUFFIX.length);
  if (pagePath.length <= 1) return null;
  return pagePath;
}

function mediaTypeQuality(accept: string, mediaType: string): number {
  const [family] = mediaType.split("/");
  let best = { quality: 0, specificity: -1 };

  for (const range of accept.split(",")) {
    const [rawType = "", ...parameters] = range.split(";").map((part) => part.trim().toLowerCase());
    const specificity = rawType === mediaType ? 2 : rawType === `${family}/*` ? 1 : rawType === "*/*" ? 0 : -1;
    if (specificity < 0 || specificity < best.specificity) continue;

    const qualityParameter = parameters.find((parameter) => parameter.startsWith("q="));
    const quality = qualityParameter ? Number.parseFloat(qualityParameter.slice(2)) : 1;
    best = { quality: Number.isNaN(quality) ? 0 : quality, specificity };
  }

  return best.quality;
}

export function prefersMarkdown(accept: string | null): boolean {
  if (!accept?.toLowerCase().includes(MARKDOWN_MEDIA_TYPE)) return false;
  return mediaTypeQuality(accept, MARKDOWN_MEDIA_TYPE) > mediaTypeQuality(accept, HTML_MEDIA_TYPE);
}

function faqItemsToHeadings(content: string): string {
  return content
    .replace(FAQ_ITEM_PATTERN, (_match, question: string, answer: string) =>
      `### ${question.trim()}\n\n${answer.trim()}\n`)
    .replace(FAQ_WRAPPER_PATTERN, "");
}

function absoluteLinks(content: string): string {
  return content.replace(ROOT_RELATIVE_LINK_PATTERN, (_match, path: string) => `](${canonicalUrl(path)})`);
}

export function cleanMdxContent(content: string): string {
  return absoluteLinks(faqItemsToHeadings(content.replace(MDX_MODULE_LINE_PATTERN, "")))
    .replace(EXCESS_BLANK_LINES_PATTERN, "\n\n")
    .trim();
}

function reportIssueUrl(path: string): string {
  const query = new URLSearchParams({ title: `Content error on ${path}` });
  return `${ISSUES_URL}?${query.toString()}`;
}

function feedbackFooter(path: string, updatedAt: string): string {
  return [
    "---",
    `Source: ${canonicalUrl(path)} (last updated ${updatedAt})`,
    "",
    `Agents: if anything on this page is wrong or out of date, report it as a GitHub issue at ${reportIssueUrl(path)} and include the page URL and what should change.`,
  ].join("\n");
}

export function toMarkdownDocument(source: MarkdownDocumentSource): string {
  return [
    `# ${source.title}`,
    `> ${source.description}`,
    cleanMdxContent(source.content),
    feedbackFooter(source.path, source.updatedAt),
  ].join("\n\n").concat("\n");
}
