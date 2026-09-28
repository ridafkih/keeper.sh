import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { MenuGate } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import { loadMotionFeatures } from "@/lib/motion-features";

export const SYNC_PANE_COLUMNS = "@3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]";

const HIDDEN = { opacity: 0, y: 12 };
const SHOWN = { opacity: 1, y: 0 };
const TRANSITION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };
const INSTANT = { duration: 0 };

interface SyncAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

interface SyncActionBarProps {
  show?: boolean;
  label: string;
  message: string | null;
  busy: boolean;
  secondary: SyncAction;
  primary: SyncAction;
}

// Beside the form it floats under the preview; alone it keeps its own space at the end so it never covers the last row.
export function SyncActionBar({ show = true, label, message, busy, secondary, primary }: SyncActionBarProps) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence initial={false}>
        {show && (
          <m.div
            className="pointer-events-none sticky bottom-4 pt-3 lg:bottom-0 @3xl:h-0 @3xl:pt-0"
            initial={HIDDEN}
            animate={SHOWN}
            exit={HIDDEN}
            transition={reduceMotion ? INSTANT : TRANSITION}
          >
            <div className={`relative bottom-0 grid grid-cols-1 gap-x-8 lg:-bottom-[calc(var(--sidebar-pad-b)-var(--sidebar-pad-x))] @3xl:absolute @3xl:inset-x-0 ${SYNC_PANE_COLUMNS}`}>
              <div role="status" className="pointer-events-auto col-end-[-1]">
                <MenuGate active={message !== null} hint={message ?? ""} className="bg-background">
                  <div className="flex items-center gap-1 rounded-2xl border border-border-elevated bg-background-elevated p-1 pl-3 shadow-xs">
                    <Text size="xs" tone="muted" className="min-w-0 flex-1 truncate">{label}</Text>
                    <Button size="compact" variant="elevated" disabled={busy || secondary.disabled} onClick={secondary.onClick}>
                      <ButtonText>{secondary.label}</ButtonText>
                    </Button>
                    <Button size="compact" disabled={busy || primary.disabled} onClick={primary.onClick}>
                      {busy && <LoaderCircle size={14} className="animate-spin" />}
                      <ButtonText>{primary.label}</ButtonText>
                    </Button>
                  </div>
                </MenuGate>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
