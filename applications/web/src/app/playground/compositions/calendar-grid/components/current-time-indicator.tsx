"use client";

import type { FC } from "react";
import { useState, useEffect } from "react";
import { useRowHeight } from "../contexts/calendar-grid-context";
import { getStartDate } from "../utils/date-utils";
import { COLUMN_COUNT, GAP } from "../utils/constants";

const startDate = getStartDate();

const getTodayPosition = () => {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffTime = todayStart.getTime() - startDate.getTime();
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return null;

  const row = Math.floor(diffDays / COLUMN_COUNT);
  const col = diffDays % COLUMN_COUNT;

  return { row, col };
};

const getTimeProgress = () => {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  return (hours * 60 + minutes) / (24 * 60);
};

const CurrentTimeIndicator: FC = () => {
  const rowHeight = useRowHeight();
  const [timeProgress, setTimeProgress] = useState(getTimeProgress);
  const position = getTodayPosition();

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeProgress(getTimeProgress());
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  if (!position) return null;

  const { row, col } = position;
  const cellWidth = 100 / COLUMN_COUNT;
  const top = row * (rowHeight + GAP) + timeProgress * rowHeight;
  const left = `${col * cellWidth}%`;
  const width = `${cellWidth}%`;

  return (
    <div
      className="absolute z-10 pointer-events-none"
      style={{
        top: `${top}px`,
        left,
        width,
      }}
    >
      <div className="relative flex items-center">
        <div className="absolute -left-1 size-2 rounded-xl bg-red-400" />
        <div className="w-full h-px bg-red-400" />
      </div>
    </div>
  );
};

export { CurrentTimeIndicator };
