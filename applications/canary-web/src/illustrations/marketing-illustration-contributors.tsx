import { AnimatePresence, LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "../lib/motion-features";
import { memo, useCallback, useEffect, useState } from "react";
import { Text } from "../components/ui/primitives/text";
import CONTRIBUTORS from "../features/marketing/contributors.json";

const VISIBLE_COUNT = 3;
const ROTATE_INTERVAL_MS = 1800;

const SLOT_ANIMATE = [
  { scale: 0.92, opacity: 0.35, filter: "blur(1px)" },
  { scale: 1, opacity: 1, filter: "blur(0px)" },
  { scale: 0.92, opacity: 0.35, filter: "blur(1px)" },
];

const TRANSITION = {
  type: "tween" as const,
  duration: 0.5,
  ease: [0.4, 0, 0.2, 1] as const,
};

type Contributor = (typeof CONTRIBUTORS)[number];

interface ContributorRowProps {
  contributor: Contributor;
}

const ContributorRow = memo(function ContributorRow({ contributor }: ContributorRowProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <img
        src={contributor.avatarUrl}
        alt=""
        width={24}
        height={24}
        className="size-6 rounded-full shrink-0 bg-interactive-border"
        loading="lazy"
      />
      <Text as="span" size="xs" tone="muted" className="truncate shrink-0">
        {contributor.username}
      </Text>
      <Text as="span" size="xs" tone="disabled" className="truncate ml-auto">
        {contributor.name}
      </Text>
    </div>
  );
});

export function MarketingIllustrationContributors() {
  const [offset, setOffset] = useState(0);
  const [rowHeight, setRowHeight] = useState(0);

  const measureRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setRowHeight(node.getBoundingClientRect().height);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setOffset((previous) => (previous + 1) % CONTRIBUTORS.length);
    }, ROTATE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  const visibleContributors = Array.from({ length: VISIBLE_COUNT }, (_, slot) => {
    const contributorIndex = (offset + slot) % CONTRIBUTORS.length;
    return { contributor: CONTRIBUTORS[contributorIndex], slot, contributorIndex };
  });

  return (
    <LazyMotion features={loadMotionFeatures}>
      <div className="relative w-full pt-3 px-4">
        <div ref={measureRef} className="invisible absolute inset-x-0" aria-hidden="true">
          <ContributorRow contributor={CONTRIBUTORS[0]} />
        </div>

        {rowHeight > 0 && (
          <div className="relative w-full" style={{ height: rowHeight * VISIBLE_COUNT }}>
            <AnimatePresence initial={false}>
              {visibleContributors.map(({ contributor, slot, contributorIndex }) => (
                <m.div
                  key={contributorIndex}
                  initial={{
                    y: rowHeight * VISIBLE_COUNT,
                    opacity: 0,
                    scale: 0.7,
                    filter: "blur(3px)",
                    rotateX: -45,
                  }}
                  animate={{
                    y: rowHeight * slot,
                    opacity: SLOT_ANIMATE[slot].opacity,
                    scale: SLOT_ANIMATE[slot].scale,
                    filter: SLOT_ANIMATE[slot].filter,
                    rotateX: 0,
                  }}
                  exit={{
                    y: -rowHeight,
                    opacity: 0,
                    scale: 0.7,
                    filter: "blur(3px)",
                    rotateX: 45,
                  }}
                  transition={TRANSITION}
                  className="absolute inset-x-0"
                  style={{ perspective: 400, transformOrigin: "center center" }}
                >
                  <ContributorRow contributor={contributor} />
                </m.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </LazyMotion>
  );
}
