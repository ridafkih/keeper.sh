import { useCallback, useLayoutEffect, useRef, useState, type PropsWithChildren } from "react";
import { useLocation, useRouterState } from "@tanstack/react-router";
import { LazyMotion, useReducedMotion, type Variants } from "motion/react";
import * as m from "motion/react-m";
import { loadMotionFeatures } from "@/lib/motion-features";
import { resolveScrollParent } from "@/lib/scroll-parent";
import {
  resolveSidebarDirection,
  type SidebarDirection,
  type SidebarLocation,
} from "@/lib/sidebar-transition";

const NUDGE = 32;
const TRANSITION = { duration: 0.22, ease: [0.2, 0, 0, 1] as const };
const INSTANT = { duration: 0 };

const pageVariants: Variants = {
  enter: (direction: SidebarDirection) => ({ x: direction === "forward" ? NUDGE : -NUDGE, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: SidebarDirection) => ({ x: direction === "forward" ? -NUDGE : NUDGE, opacity: 0 }),
};

interface TrackedLocation {
  location: SidebarLocation;
  direction: SidebarDirection | null;
}

interface DetachedPage {
  node: HTMLElement;
  height: number;
  scrollOffset: number;
}

interface ExitingPage extends DetachedPage {
  key: string;
  direction: SidebarDirection;
}

function resolveScrollTop(element: HTMLElement): number {
  const parent = resolveScrollParent(element);
  return parent ? parent.scrollTop : window.scrollY;
}

function scrollToTop(element: HTMLElement): void {
  const parent = resolveScrollParent(element);
  if (parent) parent.scrollTop = 0;
  else window.scrollTo(0, 0);
}

function ExitingPageLayer({ page, onDone }: { page: ExitingPage; onDone: () => void }) {
  const attach = useCallback((element: HTMLDivElement | null) => {
    element?.replaceChildren(page.node);
  }, [page.node]);

  return (
    <m.div
      className="pointer-events-none absolute inset-x-0"
      style={{ top: -page.scrollOffset, height: page.height }}
      custom={page.direction}
      variants={pageVariants}
      initial="center"
      animate="exit"
      transition={TRANSITION}
      onAnimationComplete={onDone}
      ref={attach}
    />
  );
}

export function SidebarPageTransition({ children }: PropsWithChildren) {
  // Matches swap when the loader resolves, later than `location`; keying on them keeps the outgoing DOM intact.
  const pathname = useRouterState({
    select: (state) => state.matches[state.matches.length - 1]?.pathname ?? state.location.pathname,
  });
  const index = useLocation({ select: (location) => location.state.__TSR_index });
  const reduceMotion = useReducedMotion() ?? false;
  const [tracked, setTracked] = useState<TrackedLocation>({ location: { pathname, index }, direction: null });
  const [exiting, setExiting] = useState<ExitingPage | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const detachedRef = useRef<DetachedPage | null>(null);

  if (tracked.location.pathname !== pathname) {
    const location = { pathname, index };
    setTracked({ location, direction: resolveSidebarDirection(tracked.location, location) });
  }

  // The router cannot keep an exited match rendered, so the outgoing page animates as its retained DOM node.
  const capturePage = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    // StrictMode re-attaches the same element after a simulated cleanup; that is not a departure.
    if (detachedRef.current?.node === element) detachedRef.current = null;
    return () => {
      detachedRef.current = {
        node: element,
        height: element.offsetHeight,
        scrollOffset: resolveScrollTop(element),
      };
    };
  }, []);

  // The new page starts at the top; the outgoing one is offset so it keeps the spot it had on screen.
  useLayoutEffect(() => {
    const detached = detachedRef.current;
    const container = containerRef.current;
    detachedRef.current = null;
    if (!detached || !container || !tracked.direction) return;
    scrollToTop(container);
    if (reduceMotion) return;
    const { pathname: to, index: at } = tracked.location;
    setExiting({ ...detached, key: `${to}:${at}`, direction: tracked.direction });
  }, [tracked, reduceMotion]);

  const clearExiting = useCallback(() => setExiting(null), []);

  return (
    <LazyMotion features={loadMotionFeatures}>
      <div ref={containerRef} className="relative lg:h-full">
        {exiting && <ExitingPageLayer key={exiting.key} page={exiting} onDone={clearExiting} />}
        <m.div
          key={pathname}
          className="lg:h-full"
          custom={tracked.direction}
          variants={pageVariants}
          initial={tracked.direction ? "enter" : false}
          animate="center"
          transition={reduceMotion ? INSTANT : TRANSITION}
          ref={capturePage}
        >
          {children}
        </m.div>
      </div>
    </LazyMotion>
  );
}
