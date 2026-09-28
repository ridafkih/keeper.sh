import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle";
import { Button, ButtonText } from "@/components/ui/primitives/button";
import { MenuGate } from "@/components/ui/primitives/menu-hint";
import { Text } from "@/components/ui/primitives/text";
import { loadMotionFeatures } from "@/lib/motion-features";
import { cn } from "@/utils/cn";

const HIDDEN = { opacity: 0, y: 12 };
const SHOWN = { opacity: 1, y: 0 };
const TRANSITION = { duration: 0.2, ease: [0.2, 0, 0, 1] as const };
const INSTANT = { duration: 0 };

interface UnsavedChangesBarProps {
  columns: string;
  show: boolean;
  saving: boolean;
  canSave: boolean;
  problem: string | null;
  error: string | null;
  onDiscard: () => void;
  onSave: () => void;
}

export function UnsavedChangesBar({ columns, show, saving, canSave, problem, error, onDiscard, onSave }: UnsavedChangesBarProps) {
  const reduceMotion = useReducedMotion() ?? false;
  const message = error ?? problem;

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence initial={false}>
        {show && (
          <m.div
            className="pointer-events-none sticky bottom-4 h-0 lg:bottom-0"
            initial={HIDDEN}
            animate={SHOWN}
            exit={HIDDEN}
            transition={reduceMotion ? INSTANT : TRANSITION}
          >
            <div className={cn("absolute inset-x-0 bottom-0 grid grid-cols-1 gap-x-8 lg:-bottom-[calc(var(--sidebar-pad-b)-var(--sidebar-pad-x))]", columns)}>
              <div role="status" className="pointer-events-auto col-end-[-1]">
                <MenuGate active={message !== null} hint={message ?? ""} className="bg-background">
                  <div className="flex items-center gap-1 rounded-2xl border border-border-elevated bg-background-elevated p-1 pl-3 shadow-xs">
                    <Text size="xs" tone="muted" className="min-w-0 flex-1 truncate">Unsaved changes</Text>
                    <Button size="compact" variant="elevated" disabled={saving} onClick={onDiscard}>
                      <ButtonText>Discard</ButtonText>
                    </Button>
                    <Button size="compact" disabled={saving || !canSave} onClick={onSave}>
                      {saving && <LoaderCircle size={14} className="animate-spin" />}
                      <ButtonText>Save</ButtonText>
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
