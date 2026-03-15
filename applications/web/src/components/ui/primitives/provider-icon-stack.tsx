import { AnimatePresence, LazyMotion } from "motion/react";
import { loadMotionFeatures } from "../../../lib/motion-features";
import * as m from "motion/react-m";
import { Text } from "./text";
import { ProviderIcon } from "./provider-icon";

interface ProviderIconStackProps {
  providers: { provider?: string; calendarType?: string }[];
  max?: number;
  animate?: boolean;
}

function ProviderIconStackItem({ provider, calendarType }: { provider?: string; calendarType?: string }) {
  return (
    <div className="size-6 rounded-full bg-background-elevated border border-border-elevated flex items-center justify-center">
      <ProviderIcon provider={provider} calendarType={calendarType} size={12} />
    </div>
  );
}

const HIDDEN = { opacity: 0, filter: "blur(4px)", width: 0 };
const VISIBLE = { opacity: 1, filter: "blur(0)", width: "auto" };

function resolveInitial(animate: boolean) {
  if (animate) return HIDDEN;
  return false as const;
}

function ProviderIconStack({ providers, max = 4, animate = false }: ProviderIconStackProps) {
  const visible = providers.slice(0, max);
  const overflow = providers.length - max;
  const initial = resolveInitial(animate);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <div className="absolute flex items-center justify-end overflow-visible pr-1">
        <div className="flex items-center">
          <AnimatePresence mode="sync">
            {visible.map((entry, index) => (
              <m.div
                key={`${entry.provider}-${index}`}
                initial={initial}
                animate={VISIBLE}
                exit={HIDDEN}
                className="max-w-3 flex justify-start"
              >
                <div className="size-6">
                  <ProviderIconStackItem provider={entry.provider} calendarType={entry.calendarType} />
                </div>
              </m.div>
            ))}
            {overflow > 0 && (
              <m.div
                key="overflow"
                initial={initial}
                animate={VISIBLE}
                exit={HIDDEN}
                className="max-w-3 flex justify-start"
            >
              <div className="size-6 min-w-6 grid place-items-center bg-background-elevated border border-border-elevated rounded-full">
                  <Text size="xs" tone="muted" className="tabular-nums text-[0.625rem]">+{overflow}</Text>
                </div>
              </m.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </LazyMotion>
  );
}

export { ProviderIconStack };
