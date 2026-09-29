import { useEffect } from "react";
import type { RefObject } from "react";
import { useRouter } from "@tanstack/react-router";

interface StripRealignOptions {
  scrollerRef: RefObject<HTMLElement | null>;
  /** Size (px) along the paging axis the strip was last aligned at. */
  alignedSizeRef: RefObject<number | null>;
  axis: "x" | "y";
  /** Puts the strip back on what it is aligned to; false when nothing is aligned yet. */
  realign: () => boolean;
}

export function useStripRealign({ scrollerRef, alignedSizeRef, axis, realign }: StripRealignOptions) {
  const router = useRouter();

  // The router replays cached scroll offsets after navigation; this registers after it and puts the strip back.
  useEffect(
    () =>
      router.subscribe("onRendered", () => {
        realign();
      }),
    [router, realign],
  );

  // Cell sizes follow the scroller's size, so a resize would drift the strip; re-snap to what it is aligned to.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const size = axis === "x" ? el.clientWidth : el.clientHeight;
      if (size === 0 || size === alignedSizeRef.current) return;
      if (!realign()) alignedSizeRef.current = size;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollerRef, alignedSizeRef, axis, realign]);
}
