import type { PropsWithChildren } from "react";

const dashedLine = "h-px grow bg-[repeating-linear-gradient(to_right,var(--color-interactive-border)_0,var(--color-interactive-border)_4px,transparent_4px,transparent_8px)]";

export function Divider({ children }: PropsWithChildren) {
  if (!children) {
    return <div className={dashedLine} />;
  }

  return (
    <div className="flex items-center gap-3">
      <div className={dashedLine} />
      <span className="text-xs text-foreground-muted shrink-0">{children}</span>
      <div className={dashedLine} />
    </div>
  );
}
