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
const PAGE_SCROLLER_SELECTOR = "[data-page-scroller]";

const pageVariants: Variants = {
  enter: (direction: SidebarDirection) => ({ x: direction === "forward" ? NUDGE : -NUDGE, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: SidebarDirection) => ({ x: direction === "forward" ? -NUDGE : NUDGE, opacity: 0 }),
};

interface TrackedLocation {
  location: SidebarLocation;
  direction: SidebarDirection | null;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface DetachedPage {
  node: HTMLElement;
  box: Box;
  scrollport: Box;
  innerScrollTop: number;
}

interface ExitingPage extends DetachedPage {
  key: string;
  direction: SidebarDirection;
}

const toBox = ({ top, left, width, height }: DOMRect): Box => ({ top, left, width, height });

function resolveScrollportBox(element: HTMLElement): Box {
  const parent = resolveScrollParent(element);
  if (parent) return toBox(parent.getBoundingClientRect());
  return { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight };
}

function scrollToTop(element: HTMLElement): void {
  const parent = resolveScrollParent(element);
  if (parent) parent.scrollTop = 0;
  else window.scrollTo(0, 0);
}

// Pinned to the viewport where it last stood, so scrolling or restoring the live page cannot drag it along.
function ExitingPageLayer({ page, onDone }: { page: ExitingPage; onDone: () => void }) {
  const attach = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    element.replaceChildren(page.node);
    const scroller = page.node.querySelector<HTMLElement>(PAGE_SCROLLER_SELECTOR);
    if (scroller) scroller.scrollTop = page.innerScrollTop;
  }, [page]);
  const { box, scrollport } = page;

  return (
    <div
      className="pointer-events-none fixed overflow-hidden"
      style={{ top: scrollport.top, left: scrollport.left, width: scrollport.width, height: scrollport.height }}
    >
      <m.div
        className="absolute"
        style={{ top: box.top - scrollport.top, left: box.left - scrollport.left, width: box.width, height: box.height }}
        custom={page.direction}
        variants={pageVariants}
        initial="center"
        animate="exit"
        transition={TRANSITION}
        onAnimationComplete={onDone}
        ref={attach}
      />
    </div>
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
        box: toBox(element.getBoundingClientRect()),
        scrollport: resolveScrollportBox(element),
        innerScrollTop: element.querySelector<HTMLElement>(PAGE_SCROLLER_SELECTOR)?.scrollTop ?? 0,
      };
    };
  }, []);

  // Forward navigation starts the new page at the top; going back leaves the position to the router's restoration.
  useLayoutEffect(() => {
    const detached = detachedRef.current;
    const container = containerRef.current;
    detachedRef.current = null;
    if (!detached || !container || !tracked.direction) return;
    if (tracked.direction === "forward") scrollToTop(container);
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
