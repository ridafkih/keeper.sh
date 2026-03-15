import type { PropsWithChildren } from "react";
import { tv } from "tailwind-variants/lite";

const upgradeCard = tv({
  base: "relative rounded-2xl p-0.5 before:absolute before:top-0.5 before:inset-x-0 before:h-px before:bg-linear-to-r before:mx-4 before:z-10 before:from-transparent before:to-transparent bg-neutral-900 before:via-neutral-400 dark:bg-neutral-800 dark:before:via-neutral-400",
});

const upgradeCardBody = tv({
  base: "rounded-[0.875rem] bg-linear-to-t from-neutral-950 to-neutral-900 dark:from-neutral-900 dark:to-neutral-800 p-4 flex flex-col gap-4",
});

const upgradeCardSection = tv({
  base: "flex flex-col",
  variants: {
    gap: {
      sm: "gap-0.5",
      md: "gap-1.5",
    },
  },
  defaultVariants: {
    gap: "md",
  },
});

const upgradeCardToggle = tv({
  base: "flex items-center gap-3 py-1.5 hover:cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:brightness-110",
});

const upgradeCardToggleTrack = tv({
  base: "w-8 h-5 rounded-full shrink-0 flex items-center p-0.5",
  variants: {
    checked: {
      true: "bg-white",
      false: "bg-neutral-600",
    },
  },
});

const upgradeCardToggleThumb = tv({
  base: "size-4 rounded-full bg-neutral-900",
  variants: {
    checked: {
      true: "ml-auto",
      false: "",
    },
  },
});

const upgradeCardFeatureRow = tv({
  base: "flex items-center gap-2.5",
});

const upgradeCardFeatureIcon = tv({
  base: "shrink-0 text-neutral-500",
});

export function UpgradeCard({ children, className }: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={upgradeCard({ className })}>
      <div className={upgradeCardBody()}>{children}</div>
    </div>
  );
}

export function UpgradeCardSection({ children, gap }: PropsWithChildren<{ gap?: "sm" | "md" }>) {
  return <div className={upgradeCardSection({ gap })}>{children}</div>;
}

type UpgradeCardToggleProps = PropsWithChildren<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}>;

export function UpgradeCardToggle({ checked, onCheckedChange, children }: UpgradeCardToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={upgradeCardToggle()}
    >
      {children}
      <div className={upgradeCardToggleTrack({ checked })}>
        <div className={upgradeCardToggleThumb({ checked })} />
      </div>
    </button>
  );
}

export function UpgradeCardFeature({ children }: PropsWithChildren) {
  return <div className={upgradeCardFeatureRow()}>{children}</div>;
}

export function UpgradeCardFeatureIcon({ children }: PropsWithChildren) {
  return <div className={upgradeCardFeatureIcon()}>{children}</div>;
}

export function UpgradeCardActions({ children }: PropsWithChildren) {
  return <div className="grid gap-1.5">{children}</div>;
}
