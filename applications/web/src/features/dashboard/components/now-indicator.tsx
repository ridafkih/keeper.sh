import { formatClock } from "@/lib/time";
import type { NowLayout } from "./now-layout";

interface NowIndicatorProps {
  layout: NowLayout;
  columnCount: number;
}

export function NowIndicator({ layout, columnCount }: NowIndicatorProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top: `${layout.topFraction * 100}%` }}
    >
      <div className="absolute inset-x-0 h-px -translate-y-1/2 bg-red-500/25" />
      {layout.todayIndex >= 0 && (
        <div
          className="absolute h-0.5 -translate-y-1/2 bg-red-500"
          style={{
            left: `${(layout.todayIndex / columnCount) * 100}%`,
            width: `${(1 / columnCount) * 100}%`,
          }}
        />
      )}
    </div>
  );
}

interface NowPillProps {
  now: Date;
  topFraction: number;
}

export function NowPill({ now, topFraction }: NowPillProps) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-1.5 -translate-y-1/2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-white"
      style={{ top: `${topFraction * 100}%` }}
    >
      {formatClock(now)}
      <span className="absolute top-1/2 left-full h-0.5 w-1.5 -translate-y-1/2 bg-red-500" />
    </span>
  );
}
