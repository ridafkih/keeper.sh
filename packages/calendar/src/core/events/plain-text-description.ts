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

/** Deeper than any real description nests, and shallow enough for the render recursion. */
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

/*
 * `<https://tel.meet/x?pin=1&hs=2>` is text, not a tag, and htmlparser2 would
 * read it as an element named `https:` and drop the URL. Only a well-formed
 * opener keeps its angle bracket into the parse. Every test stops at the next
 * angle bracket, and a comment's terminator is looked up once, so a document
 * of unterminated openers costs one pass rather than one pass each.
 */
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

/*
 * Whitespace between two tags is insignificant in HTML, so it joins the
 * separator run rather than splitting it, and a paragraph is worth the blank
 * line every renderer draws around it.
 */
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

/*
 * Whether an end tag was written or inferred is htmlparser2's answer to give,
 * recorded against the element so nothing has to be matched back up by source
 * offset afterwards.
 */
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

/*
 * Nesting deeper than the render recursion can descend overflows the stack, and
 * a description projection that throws costs the whole calendar its mirror, so
 * that document takes the token-stripping path instead.
 */
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

/*
 * A plain-text field may never lose a word to make one: `Set the <input> field`
 * is the sentence its author typed. An end tag someone wrote and a line break
 * are structure on their own; an attribute value is only a hint, and one hint
 * in a whole description is a bracketed placeholder rather than a document.
 */
const isStructuralElement = (node: ElementNode, closedElements: ReadonlySet<ChildNode>): boolean =>
  BREAK_ELEMENTS.has(node.name.toLowerCase()) || closedElements.has(node);

const isMarkup = (node: ElementNode, context: MarkupContext): boolean =>
  isStructuralElement(node, context.closedElements)
  || (context.hasStructure && hasValuedAttribute(node));

/** Only an element with no attribute value reaches here as text, so nothing needs quoting. */
const readOpenTag = (node: ElementNode): string =>
  `<${node.name}${Object.keys(node.attribs).map((name) => ` ${name}`).join("")}>`;

const normalizeLinkTarget = (value: string): string =>
  value.replace(LINK_SCHEME_PATTERN, "").replace(TRAILING_SLASH_PATTERN, "");

/*
 * An anchor whose text is its own destination projects to that destination
 * once. A labelled anchor keeps the destination beside the label, which is the
 * only place a CalDAV client can still read it.
 */
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

/*
 * Markup a parser cannot finish reading is markup that would take the author's
 * words with it, so the tags come off as text and every word survives.
 */
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

/*
 * A stylesheet is worth discarding only from a document that has something
 * else to read: `Notes <script>the script team</script> owns this` is a
 * sentence about a team, and dropping it would delete the sentence.
 */
const hasRenderableMarkup = (nodes: ChildNode[], context: MarkupContext): boolean =>
  nodes.some((node) =>
    DomUtils.isTag(node)
    && ((isMarkup(node, context) && !DISCARDED_ELEMENTS.has(node.name.toLowerCase()))
      || hasRenderableMarkup(node.children, context)));

const resolveMarkupContext = (parsed: ParsedDescription): MarkupContext => {
  const evidence = countStructuralEvidence(parsed.children, parsed.closedElements);
  const structural: MarkupContext = {
    canDiscard: false,
    closedElements: parsed.closedElements,
    hasStructure: evidence.structures > 0 || evidence.hints > 1,
  };

  return { ...structural, canDiscard: hasRenderableMarkup(parsed.children, structural) };
};

/*
 * Entities stay encoded in a description that carries no markup: `A &amp; B`
 * is then the sentence its author typed, not an escape of one.
 */
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

/*
 * A pass consumes tags and entity references and creates neither, so repeating
 * it reaches a value it leaves alone. Markup an author escaped uncovers one
 * layer at a time, and every layer costs a reference the next pass no longer
 * has.
 */
const toPlainTextDescription = (value: string | undefined): string | undefined => {
  if (!value) {
    return value;
  }
  let current = value;
  let next = projectOnce(current);
  while (next !== current) {
    current = next;
    next = projectOnce(current);
  }

  return current;
};

export { toPlainTextDescription };
