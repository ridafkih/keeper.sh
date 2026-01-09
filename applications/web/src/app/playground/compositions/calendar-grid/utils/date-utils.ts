import { COLUMN_COUNT } from "./constants";

interface MonthSpan {
  month: number;
  year: number;
  startCol: number;
  endCol: number;
}

const getStartDate = () => {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const day = firstOfMonth.getDay();
  return new Date(today.getFullYear(), today.getMonth(), 1 - day);
};

const getDateForCell = (startDate: Date, rowIndex: number, colIndex: number) => {
  const daysFromStart = rowIndex * COLUMN_COUNT + colIndex;
  const date = new Date(startDate);
  date.setDate(startDate.getDate() + daysFromStart);
  return date;
};

const getRowDates = (startDate: Date, rowIndex: number) =>
  Array.from({ length: COLUMN_COUNT }, (_, colIndex) =>
    getDateForCell(startDate, rowIndex, colIndex)
  );

const groupDatesByMonth = (dates: Date[]): MonthSpan[] => {
  const spans: MonthSpan[] = [];
  let currentSpan: MonthSpan | null = null;

  dates.forEach((date, colIndex) => {
    const month = date.getMonth();
    const year = date.getFullYear();

    if (!currentSpan || currentSpan.month !== month || currentSpan.year !== year) {
      if (currentSpan) spans.push(currentSpan);
      currentSpan = { month, year, startCol: colIndex, endCol: colIndex };
    } else {
      currentSpan.endCol = colIndex;
    }
  });

  if (currentSpan) spans.push(currentSpan);
  return spans;
};

export type { MonthSpan };
export { getStartDate, getRowDates, groupDatesByMonth };
