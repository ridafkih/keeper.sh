"use client";

import type { RefObject } from "react";
import { useEffect } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRowHeight } from "../contexts/calendar-grid-context";
import { GAP } from "./use-row-height-sync";

const ROW_COUNT = 10000;

interface UseCalendarVirtualizerOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  monthColumnRef: RefObject<HTMLDivElement | null>;
}

const useCreateCalendarVirtualizer = ({
  scrollRef,
  monthColumnRef,
}: UseCalendarVirtualizerOptions) => {
  const rowHeight = useRowHeight();

  const virtualizer = useVirtualizer({
    count: ROW_COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + GAP,
    overscan: 5,
    observeElementOffset: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) return;
      const onScroll = () => {
        callback(element.scrollTop, false);
        if (monthColumnRef.current) {
          monthColumnRef.current.style.transform = `translateY(${-element.scrollTop}px)`;
        }
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      onScroll();
      return () => element.removeEventListener("scroll", onScroll);
    },
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  return virtualizer;
};

export { useCreateCalendarVirtualizer };
