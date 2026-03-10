import { AnimatePresence, LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeaturesMax } from "../lib/motion-features";
import { memo, useEffect, useState } from "react";
import { Text } from "../components/ui/primitives/text";
import CONTRIBUTORS from "../features/marketing/contributors.json";

const VISIBLE_COUNT = 3;
const ROTATE_INTERVAL_MS = 1800;

const SLOT_STYLES = [
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

const ContributorRow = memo(function ContributorRow({
  contributor,
}: {
  contributor: Contributor;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-1.5">
      <img
        src={`${contributor.avatarUrl}?s=48`}
        alt=""
        width={24}
        height={24}
        className="size-6 rounded-full shrink-0 bg-interactive-border"
        loading="lazy"
        style={{ aspectRatio: "1 / 1" }}
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
    <LazyMotion features={loadMotionFeaturesMax}>
      <div className="flex flex-col w-full pt-3 px-4 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          {visibleContributors.map(({ contributor, slot, contributorIndex }) => (
            <m.div
              key={contributorIndex}
              layout
              initial={{ opacity: 0, scale: 0.7, filter: "blur(3px)" }}
              animate={{
                opacity: SLOT_STYLES[slot].opacity,
                scale: SLOT_STYLES[slot].scale,
                filter: SLOT_STYLES[slot].filter,
              }}
              exit={{ opacity: 0, scale: 0.7, filter: "blur(3px)", transition: { ...TRANSITION, layout: { duration: 0 } } }}
              transition={TRANSITION}
            >
              <ContributorRow contributor={contributor} />
            </m.div>
          ))}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}
