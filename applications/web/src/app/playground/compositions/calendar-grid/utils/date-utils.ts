const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const COLUMN_COUNT = 7;

const getSundayBeforeMonthStart = () => {
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

const getDayForCell = (startTimestamp: number, rowIndex: number, colIndex: number) => {
  const daysFromStart = rowIndex * COLUMN_COUNT + colIndex;
  const date = new Date(startTimestamp);
  date.setDate(date.getDate() + daysFromStart);
  return date.getDate();
};

const getMonthLetter = (month: number) => MONTH_LETTERS[month];

const shouldShowMonthIndicator = (startDate: Date, rowIndex: number) => {
  if (rowIndex === 0) return true;
  const currentMonth = getDateForCell(startDate, rowIndex, 0).getMonth();
  const prevMonth = getDateForCell(startDate, rowIndex - 1, 0).getMonth();
  return currentMonth !== prevMonth;
};

export {
  MONTH_LETTERS,
  COLUMN_COUNT,
  getSundayBeforeMonthStart,
  getDateForCell,
  getDayForCell,
  getMonthLetter,
  shouldShowMonthIndicator,
};
