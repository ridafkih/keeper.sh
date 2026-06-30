import { compile } from "html-to-text";

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

type DescriptionContentType = "html" | "text";

const htmlToPlaintext = compile({
  preserveNewlines: true,
  selectors: [
    {
      selector: "a",
      options: {
        hideLinkHrefIfSameAsText: true,
        linkBrackets: ["(", ")"],
      },
    },
    { selector: "h1", options: { uppercase: false } },
    { selector: "h2", options: { uppercase: false } },
    { selector: "h3", options: { uppercase: false } },
    { selector: "h4", options: { uppercase: false } },
    { selector: "h5", options: { uppercase: false } },
    { selector: "h6", options: { uppercase: false } },
    { selector: "p", options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
    { selector: "pre", options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
  ],
  whitespaceCharacters: " \t\r\n\f\u200B\u00A0",
  wordwrap: false,
});

const isHtmlDescription = (description: string): boolean =>
  /<\/?[A-Za-z][^>]*>/.test(description);

const getDescriptionContentType = (
  description: string | null | undefined,
): DescriptionContentType => {
  if (description && isHtmlDescription(description)) {
    return "html";
  }

  return "text";
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const derivePlaintextDescription = (description: string): PlaintextDescriptionResult => {
  try {
    const plaintextDescription = htmlToPlaintext(description).trim();

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
  getDescriptionContentType,
  isHtmlDescription,
  parseDescriptionFields,
};
export type { DescriptionContentType, DescriptionFields, PlaintextDescriptionResult };
