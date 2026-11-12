import { useEffect, type PropsWithChildren, type RefObject } from "react";
import { AnimatePresence, LazyMotion, useReducedMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { useSetPopoverOverlay } from "@/hooks/use-popover-overlay";

const HIDDEN = { height: 0, opacity: 0, filter: "blur(4px)" };
const VISIBLE = { height: "fit-content", opacity: 1, filter: "blur(0)" };
const CLIP_STYLE = { overflow: "clip" as const, overflowClipMargin: 4 };
const INSTANT = { duration: 0 };

interface SentencePanelProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  // Escape hands focus back to whatever opened the panel; a click outside leaves it where the click put it.
  onClose: (restoreFocus: boolean) => void;
}

export function SentencePanel({ open, anchorRef, onClose, children }: PropsWithChildren<SentencePanelProps>) {
  const setOverlay = useSetPopoverOverlay();
  const reduceMotion = useReducedMotion() ?? false;

  useEffect(() => {
    setOverlay(open);
    return () => setOverlay(false);
  }, [open, setOverlay]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(true);
    };

    const onPointerDown = (event: PointerEvent) => {
      const anchor = anchorRef.current;
      if (anchor && event.target instanceof Node && !anchor.contains(event.target)) onClose(false);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, onClose, anchorRef]);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <AnimatePresence>
        {open && (
          <m.div style={CLIP_STYLE} initial={HIDDEN} animate={VISIBLE} exit={HIDDEN} transition={reduceMotion ? INSTANT : undefined}>
            {children}
          </m.div>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
}
