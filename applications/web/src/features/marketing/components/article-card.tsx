import { Link } from "@tanstack/react-router";
import { Heading3 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";
import { formatIsoDate } from "@/utils/date";

const ILLUSTRATION_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(-45deg, transparent 0 14px, var(--color-illustration-stripe) 14px 15px)",
} as const;

type ArticleCardProps = {
  blurb: string;
  createdAt: string;
  path: string;
  title: string;
};

export function ArticleCard({ blurb, createdAt, path, title }: ArticleCardProps) {
  return (
    <Link
      className="group block overflow-hidden rounded-2xl border border-interactive-border bg-background shadow-xs transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      to={path}
    >
      <article className="grid grid-cols-1 sm:grid-cols-3 sm:items-stretch">
        <div
          className="bg-background h-28 sm:col-span-1 sm:h-full"
          style={ILLUSTRATION_STYLE}
          role="presentation"
        />
        <div className="flex flex-col gap-1 p-4 md:p-5 sm:col-span-2">
          <Heading3 as="h2" className="group-hover:text-foreground-hover">
            {title}
          </Heading3>
          <Text size="xs" tone="muted">
            Created {formatIsoDate(createdAt)}
          </Text>
          <Text size="sm" tone="muted" className="line-clamp-3">
            {blurb}
          </Text>
        </div>
      </article>
    </Link>
  );
}
