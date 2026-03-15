import type { JSX } from "react";
import { Heading1, Heading2, Heading3 } from "./heading";
import { ListItem, OrderedList, UnorderedList } from "./list";
import { Text } from "./text";

type MarkdownElementProps<Tag extends keyof JSX.IntrinsicElements> =
  JSX.IntrinsicElements[Tag] & {
  node?: unknown;
};

function isExternalHttpLink(href: string): boolean {
  return href.startsWith("http://") || href.startsWith("https://");
}

export function MarkdownHeadingOne({ children }: MarkdownElementProps<"h1">) {
  return <Heading1 as="h1" className="mb-3 mt-6 first:mt-0">{children}</Heading1>;
}

export function MarkdownHeadingTwo({ children }: MarkdownElementProps<"h2">) {
  return <Heading2 as="h2" className="mb-2.5 mt-6 first:mt-0">{children}</Heading2>;
}

export function MarkdownHeadingThree({ children }: MarkdownElementProps<"h3">) {
  return <Heading3 as="h3" className="mb-2 mt-5 first:mt-0">{children}</Heading3>;
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

  return (
    <a
      className="text-foreground underline underline-offset-2 hover:text-foreground-hover"
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
    <pre className="my-4 overflow-x-auto border border-interactive-border bg-background p-3 text-xs text-foreground">
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

export function MarkdownTable({
  children,
}: MarkdownElementProps<"table">) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="min-w-full border-collapse border border-interactive-border text-base tracking-tight text-foreground-muted">
        {children}
      </table>
    </div>
  );
}

export function MarkdownTableHeader({
  children,
}: MarkdownElementProps<"th">) {
  return <th className="border border-interactive-border px-2 py-1 text-left font-medium text-foreground">{children}</th>;
}

export function MarkdownTableCell({
  children,
}: MarkdownElementProps<"td">) {
  return <td className="border border-interactive-border px-2 py-1">{children}</td>;
}
