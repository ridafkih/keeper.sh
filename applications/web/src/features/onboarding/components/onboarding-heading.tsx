import type { ReactNode } from "react";
import { tv } from "tailwind-variants/lite";
import { Heading2 } from "@/components/ui/primitives/heading";
import { Text } from "@/components/ui/primitives/text";

const headingTile = tv({
  base: "mb-1 flex size-12 shrink-0 items-center justify-center rounded-[14px] inset-ring",
  variants: {
    tone: {
      caution:
        "bg-amber-50 text-amber-600 inset-ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-400 dark:inset-ring-amber-400/20",
      neutral:
        "bg-neutral-100 text-neutral-600 inset-ring-neutral-600/15 dark:bg-neutral-800 dark:text-neutral-300 dark:inset-ring-neutral-300/15",
      success:
        "bg-emerald-50 text-emerald-500 inset-ring-emerald-500/20 dark:bg-emerald-500/15 dark:text-emerald-400 dark:inset-ring-emerald-400/20",
    },
  },
});

type OnboardingHeadingTone = "caution" | "neutral" | "success";

interface OnboardingHeadingIcon {
  glyph: ReactNode;
  tone: OnboardingHeadingTone;
}

interface OnboardingHeadingProps {
  title: ReactNode;
  description: ReactNode | null;
  icon?: OnboardingHeadingIcon;
}

export function OnboardingHeading({ title, description, icon }: OnboardingHeadingProps) {
  return (
    <div className="flex flex-col gap-1 px-0.5 pb-1.5">
      {icon && (
        <div aria-hidden className={headingTile({ tone: icon.tone })}>
          {icon.glyph}
        </div>
      )}
      <Heading2 as="h1">{title}</Heading2>
      {description && <Text size="sm" tone="muted">{description}</Text>}
    </div>
  );
}
