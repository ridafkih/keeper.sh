/**
 * Creates a Date object relative to today.
 * @param daysFromToday - Number of days from today (0 = today, 1 = tomorrow, etc.)
 * @param hours - Hour of the day (0-23)
 * @param minutes - Minutes (0-59), defaults to 0
 */
const createDate = (daysFromToday: number, hours: number, minutes: number = 0): Date => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

export { createDate };
