import { NOW_PILL_HEIGHT_PX } from "./now-layout";
import type { NowLayout } from "./now-layout";

interface NowIndicatorProps {
  layout: NowLayout;
}

export function NowIndicator({ layout }: NowIndicatorProps) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 z-20"
      style={{ top: `${layout.topFraction * 100}%` }}
    >
      <div className="absolute inset-x-0 h-px bg-red-400/25" />
      {layout.today && (
        <div
          className="absolute h-0.5 -translate-y-1/2 bg-red-400"
          style={{ left: `${layout.today.left * 100}%`, width: `${layout.today.width * 100}%` }}
        />
      )}
    </div>
  );
}

// Clamped to its own half-height, so the pill isn't cut off at the scroller's top edge around midnight.
export function NowPill({ layout }: NowIndicatorProps) {
  const halfHeight = NOW_PILL_HEIGHT_PX / 2;

  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-0 flex -translate-y-1/2 items-center rounded-full bg-red-400 px-1.5 text-[10px] font-medium leading-none tabular-nums text-neutral-950"
      style={{
        height: NOW_PILL_HEIGHT_PX,
        top: `clamp(${halfHeight}px, ${layout.topFraction * 100}%, calc(100% - ${halfHeight}px))`,
      }}
    >
      {layout.label}
    </span>
  );
}
