import { AnimatePresence, LazyMotion } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { useEffect, useRef, useState } from "react";

type Phase = "button" | "cursor" | "click" | "syncing" | "done";

const PHASE_DURATIONS: Record<Phase, number> = {
  button: 600,
  cursor: 800,
  click: 400,
  syncing: 1800,
  done: 800,
};

const PHASE_ORDER: Phase[] = ["button", "cursor", "click", "syncing", "done"];

const TRANSITION_ENTER = {
  type: "tween" as const,
  duration: 0.35,
  ease: [0.4, 0, 0.2, 1] as const,
};

const INITIAL = { opacity: 0, scale: 0.9, filter: "blur(4px)" };
const ANIMATE = { opacity: 1, scale: 1, filter: "blur(0px)" };
const EXIT = { opacity: 0, scale: 0.9, filter: "blur(4px)" };

const CIRCLE_RADIUS = 16;
const CIRCLE_CIRCUMFERENCE = 2 * Math.PI * CIRCLE_RADIUS;

function SyncButton({ pressed }: { pressed: boolean }) {
  return (
    <div
      className={`flex items-center gap-1 rounded-xl tracking-tighter border px-4 py-2.5 font-medium shadow-xs transition-transform duration-100 ${
        pressed
          ? "scale-95 border-transparent bg-foreground-hover text-background"
          : "border-transparent bg-foreground text-background"
      }`}
    >
      Sync Calendars
    </div>
  );
}

function SyncCircle() {
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (circleRef.current) {
        circleRef.current.style.strokeDashoffset = "0";
      }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className="-rotate-90 size-10">
      <circle
        cx={20}
        cy={20}
        r={CIRCLE_RADIUS}
        fill="none"
        strokeWidth={2.5}
        className="stroke-background-hover"
      />
      <circle
        ref={circleRef}
        cx={20}
        cy={20}
        r={CIRCLE_RADIUS}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        className="stroke-emerald-400"
        style={{
          strokeDasharray: CIRCLE_CIRCUMFERENCE,
          strokeDashoffset: CIRCLE_CIRCUMFERENCE,
          transition: "stroke-dashoffset 1.4s ease-out",
        }}
      />
    </svg>
  );
}

export function MarketingIllustrationSetup() {
  const [phaseIndex, setPhaseIndex] = useState(0);
  const phase = PHASE_ORDER[phaseIndex];

  useEffect(() => {
    const timeout = setTimeout(() => {
      setPhaseIndex((previous) => (previous + 1) % PHASE_ORDER.length);
    }, PHASE_DURATIONS[phase]);

    return () => clearTimeout(timeout);
  }, [phase, phaseIndex]);

  const showButton = phase === "button" || phase === "cursor" || phase === "click";
  const showCursor = phase === "cursor" || phase === "click";
  const showCircle = phase === "syncing" || phase === "done";
  const pressed = phase === "click";

  return (
    <LazyMotion features={loadMotionFeatures}>
      <div className="relative w-full flex items-center justify-center px-4 h-full">
        <AnimatePresence mode="wait">
          {showButton && (
            <m.div
              key="button"
              initial={INITIAL}
              animate={ANIMATE}
              exit={EXIT}
              transition={TRANSITION_ENTER}
              className="relative"
            >
              <SyncButton pressed={pressed} />
              <AnimatePresence>
                {showCursor && (
                  <m.div
                    initial={{ opacity: 0, x: 24, y: 24, scale: 0.8, filter: "blur(2px)" }}
                    animate={{ opacity: 1, x: 8, y: 12, scale: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, scale: 0.8, filter: "blur(2px)" }}
                    transition={TRANSITION_ENTER}
                    className="absolute bottom-0 right-0 drop-shadow-sm"
                  >
                    <img src="/assets/cursor-pointer.svg" alt="" width={28} height={28} />
                  </m.div>
                )}
              </AnimatePresence>
            </m.div>
          )}

          {showCircle && (
            <m.div
              key="circle"
              initial={INITIAL}
              animate={ANIMATE}
              exit={EXIT}
              transition={TRANSITION_ENTER}
            >
              <SyncCircle />
            </m.div>
          )}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}
