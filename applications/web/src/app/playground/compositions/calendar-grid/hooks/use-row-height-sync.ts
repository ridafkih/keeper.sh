"use client";

import type { RefObject } from "react";
import { useLayoutEffect } from "react";
import { useSetRowHeight } from "../contexts/calendar-grid-context";
import { GAP, VISIBLE_ROWS } from "../utils/constants";

const useRowHeightSync = (containerRef: RefObject<HTMLDivElement | null>) => {
  const setRowHeight = useSetRowHeight();

  useLayoutEffect(() => {
    const updateRowHeight = () => {
      if (!containerRef.current) return;
      const containerHeight = containerRef.current.clientHeight;
      const totalGaps = (VISIBLE_ROWS - 1) * GAP;
      setRowHeight((containerHeight - totalGaps) / VISIBLE_ROWS);
    };

    updateRowHeight();
    window.addEventListener("resize", updateRowHeight);
    return () => window.removeEventListener("resize", updateRowHeight);
  }, [containerRef, setRowHeight]);
};

export { useRowHeightSync };
