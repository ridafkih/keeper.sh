import { DomHandler, DomUtils, ElementType, Parser } from "htmlparser2";
import { decodeHTML } from "entities";

type ChildNode = InstanceType<typeof DomHandler>["dom"][number];
type ElementNode = Extract<ChildNode, { attribs: Record<string, string> }>;

interface MarkupContext {
  readonly canDiscard: boolean;
  readonly closedElements: ReadonlySet<ChildNode>;
  readonly hasStructure: boolean;
}

interface ParsedDescription {
  readonly children: ChildNode[];
  readonly closedElements: ReadonlySet<ChildNode>;
  readonly isReadable: boolean;
}

const DISCARDED_ELEMENTS = new Set([
  "head",
  "link",
  "meta",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);

const BREAK_ELEMENTS = new Set(["br", "hr"]);

const CELL_ELEMENTS = new Set(["td", "th"]);

const LINE_ELEMENTS = new Set([
  "address",
  "article",
  "aside",
  "body",
  "caption",
  "dd",
  "div",
  "dt",
  "figcaption",
  "footer",
  "header",
  "html",
  "li",
  "main",
  "nav",
  "section",
  "tbody",
  "tfoot",
  "thead",
  "tr",
]);

const PARAGRAPH_ELEMENTS = new Set([
  "blockquote",
  "dl",
  "fieldset",
  "figure",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ol",
  "p",
  "pre",
  "table",
  "ul",
]);

// Deeper than any real description nests, and shallow enough for the render recursion.
const MAX_RENDERED_DEPTH = 1000;

const PARSE_OPTIONS = {
  lowerCaseAttributeNames: false,
  lowerCaseTags: false,
} as const;

const LINE_BREAK = "\uE000";
const LINE_BOUNDARY = "\uE001";
const PARAGRAPH_BOUNDARY = "\uE002";
const SENTINEL_PATTERN = /[\uE000-\uE002]/g;
const SEPARATOR_RUN_PATTERN = /[ \t\n]*(?:[\uE000-\uE002][ \t\n]*)+/g;

const TAG_NAME = String.raw`[a-zA-Z][a-zA-Z\d]*(?:-[a-zA-Z\d]+)*(?::[a-zA-Z][a-zA-Z\d]*)?`;
const ANGLE_PATTERN = /</g;
const TAG_TOKEN_HEAD_PATTERN = new RegExp(
  String.raw`(?:![^<>]*>|\?[^<>]*>|/?${TAG_NAME}(?=[\s/>])[^<>]*>)`,
  "y",
);
const TAG_TOKEN_PATTERN = new RegExp(String.raw`</?${TAG_NAME}(?:\s[^<>]*)?/?>`, "g");
const LINK_SCHEME_PATTERN = /^(?:[a-z][a-z\d+.-]*:\/\/|mailto:|tel:)/i;
const TRAILING_SLASH_PATTERN = /\/+$/;
const CARRIAGE_RETURN_PATTERN = /\r\n?/g;
const DOCUMENT_DIRECTIVE_PATTERN = /^(?:!doctype\b|\?)/i;

// Only a well-formed opener keeps its `<`: htmlparser2 reads `<https://tel.meet/x>` as an element and drops the URL.
const escapeStrayAngles = (value: string): string => {
  const lastCommentEnd = value.lastIndexOf("-->");

  return value.replaceAll(ANGLE_PATTERN, (_angle: string, offset: number): string => {
    if (value.startsWith("!--", offset + 1)) {
      if (lastCommentEnd >= offset + 4) {
        return "<";
      }

      return "&lt;";
    }
    TAG_TOKEN_HEAD_PATTERN.lastIndex = offset + 1;
    if (TAG_TOKEN_HEAD_PATTERN.test(value)) {
      return "<";
    }

    return "&lt;";
  });
};

const normalizeLineEndings = (value: string): string =>
  value.replaceAll(CARRIAGE_RETURN_PATTERN, "\n");

const stripSentinels = (value: string): string => value.replaceAll(SENTINEL_PATTERN, "");

// Inter-tag whitespace joins a run rather than splitting it; a paragraph draws a blank line, a line boundary one.
const countSeparatorLines = (run: string): number => {
  const breaks = run.split(LINE_BREAK).length - 1;
  if (run.includes(PARAGRAPH_BOUNDARY)) {
    return breaks + 2;
  }
  if (run.includes(LINE_BOUNDARY)) {
    return breaks + 1;
  }
  return breaks;
};

const resolveSeparators = (value: string): string =>
  value.replaceAll(SEPARATOR_RUN_PATTERN, (run) => "\n".repeat(countSeparatorLines(run)));

// Only htmlparser2 can tell a written end tag from an inferred one, and only written ones count as structure.
class DescriptionHandler extends DomHandler {
  readonly closedElements = new Set<ChildNode>();
  maxDepth = 0;

  override onopentag(name: string, attribs: Record<string, string>): void {
    super.onopentag(name, attribs);
    this.maxDepth = Math.max(this.maxDepth, this.tagStack.length);
  }

  override onclosetag(name?: string, isImplied?: boolean): void {
    const element = this.tagStack.at(-1);
    if (isImplied !== true && element !== globalThis.undefined && DomUtils.isTag(element)) {
      this.closedElements.add(element);
    }
    super.onclosetag();
  }
}

// Nesting past the render recursion overflows the stack, and a throwing projection costs the calendar its mirror.
const parseDescription = (source: string): ParsedDescription => {
  const handler = new DescriptionHandler();
  new Parser(handler, PARSE_OPTIONS).end(source);

  return {
    children: handler.dom,
    closedElements: handler.closedElements,
    isReadable: handler.maxDepth <= MAX_RENDERED_DEPTH,
  };
};

const hasValuedAttribute = (node: ElementNode): boolean =>
  Object.values(node.attribs).some((value) => value.length > 0);

// `Set the <input> field` is a sentence, not markup: a written end tag or `br` is structure, an attribute only a hint.
const isStructuralElement = (node: ElementNode, closedElements: ReadonlySet<ChildNode>): boolean =>
  BREAK_ELEMENTS.has(node.name.toLowerCase()) || closedElements.has(node);

const isMarkup = (node: ElementNode, context: MarkupContext): boolean =>
  isStructuralElement(node, context.closedElements)
  || (context.hasStructure && hasValuedAttribute(node));

// Only an element with no attribute value reaches here as text, so nothing needs quoting.
const readOpenTag = (node: ElementNode): string =>
  `<${node.name}${Object.keys(node.attribs).map((name) => ` ${name}`).join("")}>`;

const normalizeLinkTarget = (value: string): string =>
  value.replace(LINK_SCHEME_PATTERN, "").replace(TRAILING_SLASH_PATTERN, "");

// A CalDAV client sees only the projected text, so a labelled anchor must carry its href beside the label.
const renderAnchor = (element: ElementNode, inner: string): string => {
  const href = element.attribs["href"]?.trim() ?? "";
  const text = resolveSeparators(inner).trim();
  if (href.length === 0) {
    return inner;
  }
  if (text.length === 0) {
    return href;
  }
  if (normalizeLinkTarget(text) === normalizeLinkTarget(href)) {
    return inner;
  }
  return `${text} (${href})`;
};

const renderNode = (node: ChildNode, context: MarkupContext): string => {
  if (DomUtils.isText(node)) {
    return stripSentinels(node.data);
  }
  if (node.type === ElementType.Directive) {
    if (DOCUMENT_DIRECTIVE_PATTERN.test(node.data)) {
      return "";
    }
    return `<${stripSentinels(node.data)}>`;
  }
  if (!DomUtils.isTag(node)) {
    return "";
  }
  const children = (): string =>
    node.children.map((child) => renderNode(child, context)).join("");
  if (!isMarkup(node, context)) {
    return readOpenTag(node) + children();
  }
  const name = node.name.toLowerCase();
  if (DISCARDED_ELEMENTS.has(name) && context.canDiscard) {
    return "";
  }
  if (BREAK_ELEMENTS.has(name)) {
    return LINE_BREAK;
  }
  const inner = children();
  if (name === "a") {
    return renderAnchor(node, inner);
  }
  if (CELL_ELEMENTS.has(name)) {
    return ` ${inner} `;
  }
  if (PARAGRAPH_ELEMENTS.has(name)) {
    return `${PARAGRAPH_BOUNDARY}${inner}${PARAGRAPH_BOUNDARY}`;
  }
  if (LINE_ELEMENTS.has(name)) {
    return `${LINE_BOUNDARY}${inner}${LINE_BOUNDARY}`;
  }
  return inner;
};

const stripMarkupTokens = (source: string): string =>
  decodeHTML(source.replaceAll(TAG_TOKEN_PATTERN, " "));

interface MarkupEvidence {
  hints: number;
  structures: number;
}

const countStructuralEvidence = (
  nodes: ChildNode[],
  closedElements: ReadonlySet<ChildNode>,
): MarkupEvidence => {
  const counts = nodes.map((node): MarkupEvidence => {
    if (DomUtils.isComment(node)) {
      return { hints: 0, structures: 1 };
    }
    if (!DomUtils.isTag(node)) {
      return { hints: 0, structures: 0 };
    }
    const nested = countStructuralEvidence(node.children, closedElements);

    return {
      hints: nested.hints + Number(hasValuedAttribute(node)),
      structures: nested.structures + Number(isStructuralElement(node, closedElements)),
    };
  });

  return {
    hints: counts.reduce((total, entry) => total + entry.hints, 0),
    structures: counts.reduce((total, entry) => total + entry.structures, 0),
  };
};

// `Notes <script>the script team</script> owns this` is a sentence, so discard only where something else remains.
const hasRenderableMarkup = (nodes: ChildNode[], context: MarkupContext): boolean =>
  nodes.some((node) =>
    DomUtils.isTag(node)
    && ((isMarkup(node, context) && !DISCARDED_ELEMENTS.has(node.name.toLowerCase()))
      || hasRenderableMarkup(node.children, context)));

// A single attribute hint is a bracketed placeholder such as `<name here>`, not a document.
const resolveMarkupContext = (parsed: ParsedDescription): MarkupContext => {
  const evidence = countStructuralEvidence(parsed.children, parsed.closedElements);
  const structural: MarkupContext = {
    canDiscard: false,
    closedElements: parsed.closedElements,
    hasStructure: evidence.structures > 0 || evidence.hints > 1,
  };

  return { ...structural, canDiscard: hasRenderableMarkup(parsed.children, structural) };
};

// Entities stay encoded where no markup was found: `A &amp; B` is the sentence its author typed, not an escape.
const projectOnce = (value: string): string => {
  if (!value.includes("<")) {
    return value;
  }
  const source = escapeStrayAngles(normalizeLineEndings(value));
  const parsed = parseDescription(source);
  if (!parsed.isReadable) {
    return stripMarkupTokens(source).trim();
  }
  const context = resolveMarkupContext(parsed);
  if (!context.hasStructure) {
    return value;
  }

  return resolveSeparators(
    parsed.children.map((node) => renderNode(node, context)).join(""),
  ).trim();
};

// Never project twice: a second pass reads `Set &lt;timeout&gt;30&lt;/timeout&gt;` as markup and deletes the sentence.
const toPlainTextDescription = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }

  return projectOnce(value);
};

export { toPlainTextDescription };
