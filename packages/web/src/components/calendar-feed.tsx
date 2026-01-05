"use client";

import type { FC } from "react";
import { useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { Calendar } from "@/components/calendar";
import { useEvents } from "@/hooks/use-events";
import { useIntersectionObserver } from "@/hooks/use-intersection-observer";

const DAYS_PER_PAGE = 7;

const CalendarFeedContent: FC = () => {
  const { events, isLoadingMore, loadMore, size } = useEvents();
  const { ref, isIntersecting } = useIntersectionObserver();

  useEffect(() => {
    if (!isIntersecting) {
      return;
    }
    if (isLoadingMore) {
      return;
    }
    loadMore();
  }, [isIntersecting, isLoadingMore, loadMore]);

  return (
    <Calendar
      events={events}
      daysToShow={size * DAYS_PER_PAGE}
      isLoadingMore={isLoadingMore}
      lastSectionRef={ref}
    />
  );
};

export const CalendarFeed: FC = () => (
  <ErrorBoundary fallback={null}>
    <CalendarFeedContent />
  </ErrorBoundary>
);
