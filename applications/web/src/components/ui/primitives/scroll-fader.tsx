import { useEffect, useRef, useSyncExternalStore, type PropsWithChildren } from "react";
import { createPortal } from "react-dom";
import { resolveScrollParent } from "@/lib/scroll-parent";

const FADE_DISTANCE_PX = 48;
const BAND_HEIGHT_PX = 96;
const BLEED_PX = 16;

const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);

const subscribeNever = () => () => {};
const isClient = () => true;
const isServer = () => false;

// Offsets ignore transforms, so a page still sliding in through the sidebar transition measures at rest.
// Scroll is subtracted for every ancestor up to a fixed one, which sits still however the page above it scrolls.
function resolveViewportOffset(element: HTMLElement): { left: number; top: number } {
  let left = 0;
  let top = 0;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    left += node.offsetLeft + (node.offsetParent?.clientLeft ?? 0);
    top += node.offsetTop + (node.offsetParent?.clientTop ?? 0);
  }
  for (let node = element.parentElement; node; node = node.parentElement) {
    left -= node.scrollLeft;
    top -= node.scrollTop;
    if (getComputedStyle(node).position === "fixed") break;
  }
  return { left, top };
}

// Measured through offsets, so a pane still sliding in doesn't park the band over its bottom border.
function resolveScrollportBottom(element: HTMLElement): number {
  const parent = resolveScrollParent(element);
  return parent ? resolveViewportOffset(parent).top + parent.clientTop + parent.clientHeight : window.innerHeight;
}

export function ScrollFader({ children }: PropsWithChildren) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const bandRef = useRef<HTMLDivElement>(null);
  const mounted = useSyncExternalStore(subscribeNever, isClient, isServer);

  useEffect(() => {
    let frame = 0;

    const update = () => {
      frame = 0;
      const wrapper = wrapperRef.current;
      const anchor = anchorRef.current;
      const sentinel = sentinelRef.current;
      const band = bandRef.current;
      if (!wrapper || !anchor || !sentinel || !band) return;
      const remaining = sentinel.getBoundingClientRect().top - anchor.getBoundingClientRect().top;
      band.style.opacity = String(clamp01(remaining / FADE_DISTANCE_PX));
      band.style.left = `${resolveViewportOffset(wrapper).left - BLEED_PX}px`;
      band.style.width = `${wrapper.offsetWidth + BLEED_PX * 2}px`;
      band.style.top = `${resolveScrollportBottom(wrapper) - BAND_HEIGHT_PX}px`;
    };

    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };

    update();
    const resizeObserver = new ResizeObserver(schedule);
    if (wrapperRef.current) resizeObserver.observe(wrapperRef.current);
    // Scroll events don't bubble, so the capture phase is what sees the column or the window scrolling.
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", schedule, { capture: true });
      window.removeEventListener("resize", schedule);
    };
  }, [mounted]);

  // The band lives outside the scroll column so it can bleed past the content edges without clipping.
  const band = (
    <div
      ref={bandRef}
      className="pointer-events-none fixed z-[5] bg-linear-to-t from-background to-transparent opacity-0"
      style={{ height: BAND_HEIGHT_PX }}
    />
  );

  return (
    <div ref={wrapperRef} className="relative">
      {children}
      <div ref={sentinelRef} />
      <div ref={anchorRef} className="sticky bottom-0 h-0" />
      {mounted && createPortal(band, document.body)}
    </div>
  );
}
