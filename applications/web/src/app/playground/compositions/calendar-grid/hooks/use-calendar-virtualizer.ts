"use client";

import type { RefObject } from "react";
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useRowHeight, useSetScrollOffset, useSetScrollDirection } from "../contexts/calendar-grid-context";
import { ROW_COUNT, GAP } from "../utils/constants";

interface UseCalendarVirtualizerOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  weekColumnRef: RefObject<HTMLDivElement | null>;
}

const useCreateCalendarVirtualizer = ({ scrollRef, weekColumnRef }: UseCalendarVirtualizerOptions) => {
  const rowHeight = useRowHeight();
  const setScrollOffset = useSetScrollOffset();
  const setScrollDirection = useSetScrollDirection();
  const prevScrollTop = useRef(0);

  const virtualizer = useVirtualizer({
    count: ROW_COUNT,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight + GAP,
    overscan: 5,
    observeElementOffset: (instance, callback) => {
      const element = instance.scrollElement;
      if (!element) {
        return;
      }
      const onScroll = () => {
        const { scrollTop } = element;
        callback(scrollTop, false);
        setScrollOffset(scrollTop);
        if (scrollTop !== prevScrollTop.current) {
          if (scrollTop > prevScrollTop.current) {
            setScrollDirection("down");
          } else {
            setScrollDirection("up");
          }
          prevScrollTop.current = scrollTop;
        }
        if (weekColumnRef.current) {
          weekColumnRef.current.style.transform = `translateY(${-scrollTop}px)`;
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
