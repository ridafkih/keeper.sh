import { useEffect, useRef, useState } from "react";
import { LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "../lib/motion-features";
import { tv } from "tailwind-variants/lite";
import { Text } from "../components/ui/primitives/text";

const PLACEHOLDER_COUNTS = [3, 5, 2, 7, 4, 6, 1, 8, 3, 5, 4, 6, 2, 7, 5];
const GRAPH_HEIGHT = 128;
const MIN_BAR_HEIGHT = 16;
const GROWTH_SPACE = GRAPH_HEIGHT - MIN_BAR_HEIGHT;
const MAX_COUNT = Math.max(...PLACEHOLDER_COUNTS);
const TOTAL_EVENTS = PLACEHOLDER_COUNTS.reduce((sum, count) => sum + count, 0);
const TODAY_INDEX = 7;

type Period = "past" | "today" | "future";

const barStyle = tv({
  base: "flex-1 rounded-[0.625rem]",
  variants: {
    period: {
      past: "bg-background-hover border border-border-elevated",
      today: "bg-emerald-400 border-transparent",
      future:
        "bg-emerald-400 border-emerald-500 bg-[repeating-linear-gradient(-45deg,transparent_0_4px,var(--color-illustration-stripe)_4px_8px)]",
    },
  },
});

function resolvePeriod(index: number): Period {
  if (index < TODAY_INDEX) return "past";
  if (index === TODAY_INDEX) return "today";
  return "future";
}

function resolveBarHeight(count: number): number {
  return MIN_BAR_HEIGHT + (count / MAX_COUNT) * GROWTH_SPACE;
}

interface BarData {
  height: number;
  period: Period;
  index: number;
}

const BARS: BarData[] = PLACEHOLDER_COUNTS.map((count, index) => ({
  height: resolveBarHeight(count),
  period: resolvePeriod(index),
  index,
}));

const BAR_TRANSITION_EASE = [0.4, 0, 0.2, 1] as const;

export function HowItWorksSync() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "-64px" },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <div ref={containerRef} className="w-full px-6 sm:px-0 sm:pl-6 sm:-mr-8 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Text size="sm" tone="muted" className="tabular-nums">
            {TOTAL_EVENTS} events
          </Text>
          <Text size="sm" tone="muted" className="tabular-nums">
            This Week
          </Text>
        </div>
        <div className="flex gap-0.5" style={{ height: GRAPH_HEIGHT }}>
          {BARS.map((bar) => (
            <div key={bar.index} className="flex-1 flex items-end">
              <m.div
                className={barStyle({ period: bar.period, className: "w-full" })}
                initial={{ height: MIN_BAR_HEIGHT }}
                animate={{ height: visible ? bar.height : MIN_BAR_HEIGHT }}
                transition={{
                  duration: 0.3,
                  ease: BAR_TRANSITION_EASE,
                  delay: bar.index * 0.02,
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </LazyMotion>
  );
}
