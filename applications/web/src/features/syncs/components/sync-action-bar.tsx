import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { MenuGate } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import { loadMotionFeatures } from "@/lib/motion-features";

export const SYNC_PANE_COLUMNS = "@3xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]";
export const SYNC_SETUP_COLUMNS = "lg:grid-cols-[minmax(0,40rem)_minmax(0,26rem)] lg:justify-center";

// Where the form and preview sit side by side, the bar floats under the preview instead of taking its own row.
const LAYOUTS = {
  pane: { bar: "@3xl:h-0 @3xl:pt-0", columns: `gap-x-8 @3xl:absolute @3xl:inset-x-0 ${SYNC_PANE_COLUMNS}` },
  setup: { bar: "lg:h-0 lg:pt-0", columns: `gap-x-12 lg:absolute lg:inset-x-0 ${SYNC_SETUP_COLUMNS}` },
};

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
  layout?: keyof typeof LAYOUTS;
  show?: boolean;
  label: string;
  message: string | null;
  busy: boolean;
  secondary: SyncAction;
  primary: SyncAction;
}

// Alone it keeps its own space at the end, so it never covers the last row.
export function SyncActionBar({ layout = "pane", show = true, label, message, busy, secondary, primary }: SyncActionBarProps) {
  const reduceMotion = useReducedMotion() ?? false;

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence initial={false}>
        {show && (
          <m.div
            className={`pointer-events-none sticky bottom-4 z-[6] pt-3 lg:bottom-0 ${LAYOUTS[layout].bar}`}
            initial={HIDDEN}
            animate={SHOWN}
            exit={HIDDEN}
            transition={reduceMotion ? INSTANT : TRANSITION}
          >
            <div className={`relative bottom-0 grid grid-cols-1 lg:-bottom-[calc(var(--sidebar-pad-b)-var(--sidebar-pad-x))] ${LAYOUTS[layout].columns}`}>
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
