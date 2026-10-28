export interface ContentFaqEntry {
  answer: string;
  question: string;
}

const FAQ_ITEM_PATTERN = /<faq-item question="([^"]*)">([\s\S]*?)<\/faq-item>/g;
const FAQ_SECTION_HEADING_PATTERN = /^##\s+(?:faq|frequently asked questions|common questions\b.*)$/i;
const SECTION_HEADING_PATTERN = /^##\s/;
const QUESTION_HEADING_PATTERN = /^###\s+/m;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\([^)]*\)/g;
const EMPHASIS_PATTERN = /(\*\*|__|`)(.+?)\1/g;
const EXCESS_BLANK_LINES_PATTERN = /\n{3,}/g;

function toPlainText(markdown: string): string {
  return markdown
    .replace(MARKDOWN_LINK_PATTERN, "$1")
    .replace(EMPHASIS_PATTERN, "$2")
    .replace(EXCESS_BLANK_LINES_PATTERN, "\n\n")
    .trim();
}

function extractFaqItems(content: string): ContentFaqEntry[] {
  return [...content.matchAll(FAQ_ITEM_PATTERN)].map((match) => ({
    answer: match[2].trim(),
    question: match[1].trim(),
  }));
}

function extractFaqSection(content: string): ContentFaqEntry[] {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => FAQ_SECTION_HEADING_PATTERN.test(line.trim()));
  if (start === -1) return [];

  const sectionLength = lines.slice(start + 1).findIndex((line) => SECTION_HEADING_PATTERN.test(line));
  const sectionLines = sectionLength === -1
    ? lines.slice(start + 1)
    : lines.slice(start + 1, start + 1 + sectionLength);

  return sectionLines
    .join("\n")
    .split(QUESTION_HEADING_PATTERN)
    .slice(1)
    .map((block) => {
      const [question = "", ...answer] = block.split("\n");
      return { answer: toPlainText(answer.join("\n")), question: question.trim() };
    });
}

export function extractContentFaq(content: string): ContentFaqEntry[] {
  const items = extractFaqItems(content);
  if (items.length > 0) return items;
  return extractFaqSection(content);
}
