import type { IcsLimits } from "../options";

const doubleEncodedEntity = /&amp;(amp|lt|gt|quot|nbsp|#\d+);/gu;

const decodedOnce = (text: string): string => text.replaceAll(doubleEncodedEntity, "&$1;");

const escapedMarkup = (tag: string): string =>
  tag.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const markupTag = /<[^>]*>/gu;

/*
 * A "<" with no ">" after it can only appear past the final ">", and the scanner passes that
 * remainder through untouched. Splitting there keeps that behaviour while letting every tag
 * before it be matched in a single pass.
 */
const unclosedTagAt = (text: string): number => text.indexOf("<", text.lastIndexOf(">") + 1);

const headOf = (text: string, tailStart: number): string => {
  if (tailStart === -1) {
    return text;
  }
  return text.slice(0, tailStart);
};

const tailOf = (text: string, tailStart: number): string => {
  if (tailStart === -1) {
    return "";
  }
  return text.slice(tailStart);
};

const withoutMarkup = (text: string, maxDepth: number): string => {
  const tailStart = unclosedTagAt(text);
  const head = headOf(text, tailStart);
  const parts: string[] = [];
  const scan = { depth: 0, lastIndex: 0 };
  for (const match of head.matchAll(markupTag)) {
    const [tag] = match;
    parts.push(head.slice(scan.lastIndex, match.index));
    scan.lastIndex = match.index + tag.length;
    const isClosingTag = tag.startsWith("</");
    if (isClosingTag && scan.depth > 0) {
      scan.depth -= 1;
      continue;
    }
    if (!isClosingTag && scan.depth < maxDepth) {
      scan.depth += 1;
      continue;
    }
    parts.push(escapedMarkup(tag));
  }
  parts.push(head.slice(scan.lastIndex), tailOf(text, tailStart));
  return parts.join("");
};

const toPlainTextDescription = (description: string, limits: IcsLimits): string =>
  decodedOnce(withoutMarkup(description, limits.maxDescriptionDepth));

export { toPlainTextDescription };
