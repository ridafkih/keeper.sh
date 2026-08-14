import { Children, isValidElement, type JSX, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Heading1, Heading2, Heading3 } from "./heading";
import { ListItem, OrderedList, UnorderedList } from "./list";
import { Text } from "./text";

type MarkdownElementProps<Tag extends keyof JSX.IntrinsicElements> =
  JSX.IntrinsicElements[Tag] & {
  node?: unknown;
};

const SITE_HOSTNAMES = ["keeper.sh", "www.keeper.sh"];
const HTTP_PROTOCOLS = ["http:", "https:"];
const LINK_CLASS_NAME = "text-foreground underline underline-offset-2 hover:text-foreground-hover";
const LABEL_COLUMN_MIN_WIDTH = "18ch";
const COLUMN_MIN_WIDTH = "13ch";
const COMBINING_MARKS = /\p{M}+/gu;
const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const SLUG_EDGE_SEPARATORS = /^-+|-+$/g;

function isSiteHttpUrl(url: URL): boolean {
  return HTTP_PROTOCOLS.includes(url.protocol) && SITE_HOSTNAMES.includes(url.hostname);
}

function isExternalHttpLink(href: string): boolean {
  if (!URL.canParse(href)) return false;

  const url = new URL(href);
  return HTTP_PROTOCOLS.includes(url.protocol) && !isSiteHttpUrl(url);
}

function toInternalPath(href: string): string | undefined {
  if (href.startsWith("/")) return href;
  if (!URL.canParse(href)) return undefined;

  const url = new URL(href);
  if (!isSiteHttpUrl(url)) return undefined;

  return `${url.pathname}${url.search}${url.hash}`;
}

function toPlainText(children: ReactNode): string {
  return Children.toArray(children).reduce<string>((text, child) => {
    if (typeof child === "string" || typeof child === "number") return `${text}${child}`;
    if (!isValidElement<{ children?: ReactNode }>(child)) return text;
    return `${text}${toPlainText(child.props.children)}`;
  }, "");
}

function headingId(children: ReactNode): string | undefined {
  const slug = toPlainText(children)
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(NON_SLUG_CHARACTERS, "-")
    .replace(SLUG_EDGE_SEPARATORS, "");

  return slug.length > 0 ? slug : undefined;
}

export function MarkdownHeadingOne({ children }: MarkdownElementProps<"h1">) {
  return <Heading1 as="h1" className="mb-3 mt-6 first:mt-0" id={headingId(children)}>{children}</Heading1>;
}

export function MarkdownHeadingTwo({ children }: MarkdownElementProps<"h2">) {
  return <Heading2 as="h2" className="mb-2.5 mt-6 first:mt-0" id={headingId(children)}>{children}</Heading2>;
}

export function MarkdownHeadingThree({ children }: MarkdownElementProps<"h3">) {
  return <Heading3 as="h3" className="mb-2 mt-5 first:mt-0" id={headingId(children)}>{children}</Heading3>;
}

export function MarkdownParagraph({ children }: MarkdownElementProps<"p">) {
  return (
    <Text align="left" size="base" tone="muted" className="my-3 leading-7">
      {children}
    </Text>
  );
}

export function MarkdownLink({
  children,
  href,
  title,
}: MarkdownElementProps<"a">) {
  const normalizedHref = typeof href === "string" ? href : "#";
  const normalizedTitle = typeof title === "string" ? title : undefined;
  const internalPath = toInternalPath(normalizedHref);

  if (internalPath) {
    return (
      <Link className={LINK_CLASS_NAME} title={normalizedTitle} to={internalPath}>
        {children}
      </Link>
    );
  }

  return (
    <a
      className={LINK_CLASS_NAME}
      href={normalizedHref}
      rel={isExternalHttpLink(normalizedHref) ? "noopener noreferrer" : undefined}
      target={isExternalHttpLink(normalizedHref) ? "_blank" : undefined}
      title={normalizedTitle}
    >
      {children}
    </a>
  );
}

export function MarkdownUnorderedList({
  children,
}: MarkdownElementProps<"ul">) {
  return <UnorderedList>{children}</UnorderedList>;
}

export function MarkdownOrderedList({
  children,
}: MarkdownElementProps<"ol">) {
  return <OrderedList>{children}</OrderedList>;
}

export function MarkdownListItem({ children }: MarkdownElementProps<"li">) {
  return <ListItem>{children}</ListItem>;
}

export function MarkdownInlineCode({ children }: MarkdownElementProps<"code">) {
  return (
    <code className="rounded-md border border-border-elevated bg-background-elevated px-1.5 py-0.5 font-mono text-[0.85em] tracking-normal text-foreground">
      {children}
    </code>
  );
}

export function MarkdownCodeBlock({
  children,
}: MarkdownElementProps<"pre">) {
  return (
    <pre className="my-4 overflow-x-auto border border-interactive-border bg-background p-3 text-xs text-foreground [&_code]:rounded-none [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[length:inherit]">
      {children}
    </pre>
  );
}

export function MarkdownBlockquote({ children }: MarkdownElementProps<"blockquote">) {
  return (
    <blockquote className="my-4 border-l-2 border-interactive-border pl-3">
      <Text align="left" size="base" tone="muted" className="leading-7">
        {children}
      </Text>
    </blockquote>
  );
}

export function MarkdownRule() {
  return <hr className="my-6 border-interactive-border" />;
}

export function MarkdownTableHeader({
  children,
}: MarkdownElementProps<"th">) {
  return (
    <th className="border-interactive-border border-r border-b bg-background-elevated px-2 py-3 sm:px-3 text-left align-top font-medium text-foreground break-words">
      {children}
    </th>
  );
}

export function MarkdownTableCell({
  children,
}: MarkdownElementProps<"td">) {
  return (
    <td className="border-interactive-border border-r border-b px-2 py-3 sm:px-3 align-top break-words">
      {children}
    </td>
  );
}

export function MarkdownTableSection({
  children,
}: MarkdownElementProps<"thead">) {
  return <thead className="contents">{children}</thead>;
}

export function MarkdownTableBody({
  children,
}: MarkdownElementProps<"tbody">) {
  return <tbody className="contents">{children}</tbody>;
}

export function MarkdownTableRow({ children }: MarkdownElementProps<"tr">) {
  return <tr className="contents">{children}</tr>;
}

function countHeaderCells(children: ReactNode): number {
  return Children.toArray(children).reduce<number>((total, child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return total;
    if (child.type === MarkdownTableHeader) return total + 1;
    return total + countHeaderCells(child.props.children);
  }, 0);
}

export function MarkdownTable({
  children,
}: MarkdownElementProps<"table">) {
  const columnCount = Math.max(countHeaderCells(children), 1);
  const gridTemplateColumns = [
    `minmax(${LABEL_COLUMN_MIN_WIDTH}, 1.5fr)`,
    ...Array.from(
      { length: columnCount - 1 },
      () => `minmax(${COLUMN_MIN_WIDTH}, 1fr)`,
    ),
  ].join(" ");

  return (
    <div className="my-4 overflow-x-auto rounded-2xl border border-interactive-border [contain:inline-size]">
      <table
        className="grid w-full text-sm tracking-tight text-foreground-muted [&_tbody_tr:last-child_:is(td,th)]:border-b-0 [&_tr_:is(td,th):last-child]:border-r-0"
        style={{ gridTemplateColumns }}
      >
        {children}
      </table>
    </div>
  );
}
