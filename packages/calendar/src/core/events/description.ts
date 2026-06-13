import { parseHTML } from "linkedom";

interface PlaintextDescriptionResult {
  plaintextDescription?: string;
  plaintextDescriptionDerivationError?: string;
}

interface DescriptionFields extends PlaintextDescriptionResult {
  description?: string;
}

interface ParseDescriptionOptions {
  contentType?: string | null;
  plaintextDescription?: string | null;
}

interface DomNode {
  childNodes?: Iterable<DomNode>;
  getAttribute?: (name: string) => string | null;
  localName?: string;
  nodeType?: number;
  textContent?: string | null;
}

interface ParsedHtmlDocument {
  document: {
    body: DomNode;
  };
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const HTML_TAG_PATTERN = /<\/?\w+[^>]*>/;
const WHITESPACE_PATTERN = /[ \t\f\v]+/g;
const LINE_WHITESPACE_PATTERN = / *\n */g;
const MANY_LINE_BREAKS_PATTERN = /\n{3,}/g;
const NON_BREAKING_SPACE_PATTERN = /\u00A0/g;

const BLOCK_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "blockquote",
  "dd",
  "div",
  "dl",
  "dt",
  "fieldset",
  "figcaption",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);

const SKIPPED_ELEMENTS = new Set(["noscript", "script", "style", "template"]);

const normalizePlaintext = (value: string): string =>
  value
    .replaceAll(NON_BREAKING_SPACE_PATTERN, " ")
    .replaceAll(WHITESPACE_PATTERN, " ")
    .replaceAll(LINE_WHITESPACE_PATTERN, "\n")
    .replaceAll(MANY_LINE_BREAKS_PATTERN, "\n\n")
    .trim();

const isHtmlDescription = (description: string): boolean =>
  HTML_TAG_PATTERN.test(description);

const appendLineBreak = (parts: string[]): void => {
  const previous = parts.at(-1);
  if (!previous || previous.endsWith("\n")) {
    return;
  }
  parts.push("\n");
};

const appendText = (parts: string[], text: string | null | undefined): void => {
  if (!text) {
    return;
  }
  parts.push(text);
};

const readElementName = (node: DomNode): string => {
  if (!node.localName) {
    return "";
  }
  return node.localName.toLowerCase();
};

const getNodeText = (node: DomNode): string =>
  node.textContent ?? "";

const appendAnchor = (parts: string[], node: DomNode): void => {
  const label = normalizePlaintext(getNodeText(node));
  const href = node.getAttribute?.("href")?.trim();

  if (!href) {
    appendText(parts, label);
    return;
  }

  if (!label || label === href) {
    appendText(parts, href);
    return;
  }

  appendText(parts, `${label} (${href})`);
};

const walkNode = (parts: string[], node: DomNode): void => {
  if (node.nodeType === TEXT_NODE) {
    appendText(parts, node.textContent);
    return;
  }

  if (node.nodeType !== ELEMENT_NODE) {
    return;
  }

  const elementName = readElementName(node);
  if (SKIPPED_ELEMENTS.has(elementName)) {
    return;
  }

  if (elementName === "br") {
    appendLineBreak(parts);
    return;
  }

  if (elementName === "a") {
    appendAnchor(parts, node);
    return;
  }

  if (BLOCK_ELEMENTS.has(elementName)) {
    appendLineBreak(parts);
  }

  for (const child of node.childNodes ?? []) {
    walkNode(parts, child);
  }

  if (BLOCK_ELEMENTS.has(elementName)) {
    appendLineBreak(parts);
  }
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const derivePlaintextDescription = (description: string): PlaintextDescriptionResult => {
  try {
    const parsed = parseHTML(
      `<!doctype html><html><body>${description}</body></html>`,
    ) as unknown as ParsedHtmlDocument;
    const { document } = parsed;
    const parts: string[] = [];
    walkNode(parts, document.body as DomNode);
    const plaintextDescription = normalizePlaintext(parts.join(""));

    if (!plaintextDescription) {
      return {};
    }

    return { plaintextDescription };
  } catch (error) {
    return { plaintextDescriptionDerivationError: toErrorMessage(error) };
  }
};

const parseDescriptionFields = (
  description: string | null | undefined,
  options: ParseDescriptionOptions = {},
): DescriptionFields => {
  if (!description) {
    return {};
  }

  const result: DescriptionFields = { description };

  if (options.plaintextDescription) {
    result.plaintextDescription = options.plaintextDescription;
    return result;
  }

  const contentType = options.contentType?.toLowerCase();
  const shouldDerivePlaintext = contentType === "html" || isHtmlDescription(description);
  if (!shouldDerivePlaintext) {
    return result;
  }

  return {
    ...result,
    ...derivePlaintextDescription(description),
  };
};

const countPlaintextDescriptionDerivationFailures = (
  events: Iterable<{ plaintextDescriptionDerivationError?: string }>,
): number => {
  let count = 0;
  for (const event of events) {
    if (event.plaintextDescriptionDerivationError) {
      count += 1;
    }
  }
  return count;
};

export {
  countPlaintextDescriptionDerivationFailures,
  derivePlaintextDescription,
  isHtmlDescription,
  parseDescriptionFields,
};
export type { DescriptionFields, PlaintextDescriptionResult };
