import { useRef, useCallback, useLayoutEffect, useState, useEffect, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getWeekForRow, type WeekStartDay } from "../utils/date-calculations";

const TOTAL_WEEKS = 20000;
const CENTER_OFFSET = TOTAL_WEEKS / 2;
const DAYS_PER_WEEK = 7;

interface YearMonth {
  year: number;
  month: number;
}

interface UseCalendarGridOptions {
  overscan?: number;
  weekStartDay?: WeekStartDay;
}

const useCalendarGrid = ({
  overscan = 5,
  weekStartDay = 0,
}: UseCalendarGridOptions = {}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const anchorDate = useRef(new Date());
  const hasScrolledToCenter = useRef(false);
  const [cellSize, setCellSize] = useState(80);
  const [centeredYearMonth, setCenteredYearMonth] = useState<YearMonth>(() => ({
    year: new Date().getFullYear(),
    month: new Date().getMonth(),
  }));

  const virtualizer = useVirtualizer({
    count: TOTAL_WEEKS,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => cellSize, [cellSize]),
    overscan,
  });

  useEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    const updateCellSize = () => {
      const width = element.clientWidth;
      const newCellSize = Math.floor(width / DAYS_PER_WEEK);
      setCellSize(newCellSize);
    };

    updateCellSize();

    const resizeObserver = new ResizeObserver(updateCellSize);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    virtualizer.measure();
  }, [cellSize, virtualizer]);

  // Track centered month based on scroll position
  useEffect(() => {
    const element = parentRef.current;
    if (!element || cellSize === 0) return;

    const updateCenteredMonth = () => {
      const scrollTop = element.scrollTop;
      const viewportHeight = element.clientHeight;
      const centerOffset = scrollTop + viewportHeight / 2;
      const centeredRowIndex = Math.floor(centerOffset / cellSize);
      const weekOffset = centeredRowIndex - CENTER_OFFSET;
      const { days } = getWeekForRow(anchorDate.current, weekOffset, weekStartDay);
      // Use the middle day of the week (index 3) to determine the month
      const middleDay = days[3];
      if (middleDay) {
        setCenteredYearMonth({
          year: middleDay.getFullYear(),
          month: middleDay.getMonth(),
        });
      }
    };

    updateCenteredMonth();
    element.addEventListener("scroll", updateCenteredMonth, { passive: true });
    return () => element.removeEventListener("scroll", updateCenteredMonth);
  }, [cellSize, weekStartDay]);

  const virtualIndexToWeekOffset = useCallback(
    (virtualIndex: number): number => virtualIndex - CENTER_OFFSET,
    []
  );

  const getWeekDates = useCallback(
    (virtualRowIndex: number): Date[] => {
      const weekOffset = virtualIndexToWeekOffset(virtualRowIndex);
      const { days } = getWeekForRow(anchorDate.current, weekOffset, weekStartDay);
      return days;
    },
    [weekStartDay, virtualIndexToWeekOffset]
  );

  const scrollToToday = useCallback(() => {
    virtualizer.scrollToIndex(CENTER_OFFSET, { align: "center" });
  }, [virtualizer]);

  useLayoutEffect(() => {
    if (!hasScrolledToCenter.current && parentRef.current) {
      virtualizer.scrollToIndex(CENTER_OFFSET, { align: "center" });
      hasScrolledToCenter.current = true;
    }
  }, [virtualizer]);

  return {
    parentRef,
    virtualizer,
    getWeekDates,
    scrollToToday,
    cellSize,
    centeredYearMonth,
  };
};

export { useCalendarGrid, CENTER_OFFSET };
export type { YearMonth };
