import type { PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

/**
 * A small, non-interactive label. Deliberately flat and unpadded of shadow, so
 * it never reads as a button: nothing here is clickable.
 *
 * `TagDot` sets a tag apart without a hue, which the theme does not carry.
 */

const tagList = tv({
  base: "flex flex-wrap items-center gap-x-2 gap-y-1.5 list-none",
});

const tag = tv({
  base: "inline-flex items-center gap-1.5 rounded-full border border-interactive-border px-2.5 py-0.5 text-xs tracking-tight",
  variants: {
    tone: {
      default: "text-foreground",
      muted: "text-foreground-muted",
    },
  },
  defaultVariants: {
    tone: "muted",
  },
});

/**
 * One axis, three terminal values: the theme carries no hues to tell tags
 * apart, so weight and fill do it instead. A second axis would emit two
 * background classes and let CSS source order pick the winner.
 */
const tagDot = tv({
  base: "size-1.5 shrink-0 rounded-full",
  variants: {
    emphasis: {
      strong: "bg-foreground",
      soft: "bg-foreground-muted",
      outline: "ring-1 ring-inset ring-foreground-muted",
    },
  },
  defaultVariants: {
    emphasis: "soft",
  },
});

type TagTone = "default" | "muted";

type TagListProps = PropsWithChildren<{ className?: string; label?: string }>;
type TagProps = PropsWithChildren<{ className?: string; tone?: TagTone }>;
type TagDotProps = { className?: string; emphasis?: "strong" | "soft" | "outline" };

export function TagList({ children, className, label }: TagListProps) {
  return (
    <ul aria-label={label} className={tagList({ className })}>
      {children}
    </ul>
  );
}

export function Tag({ children, className, tone }: TagProps) {
  return <li className={tag({ tone, className })}>{children}</li>;
}

export function TagDot({ className, emphasis }: TagDotProps) {
  return <span aria-hidden="true" className={tagDot({ emphasis, className })} />;
}
