import type { SyncState } from "@keeper.sh/data-schemas";
import { cn } from "@/utils/cn";

const DOT_CLASS: Record<SyncState, string> = {
  empty: "border border-foreground-muted",
  ok: "bg-emerald-500",
  paused: "bg-foreground-disabled",
  problem: "bg-linear-to-b from-amber-400 to-amber-500",
};

export function SyncStatusDot({ state, className }: { state: SyncState; className?: string }) {
  return <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT_CLASS[state], className)} />;
}
