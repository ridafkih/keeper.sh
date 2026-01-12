const createDate = (daysFromToday: number, hours: number, minutes = 0): Date => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  date.setHours(hours, minutes, 0, 0);
  return date;
};

export { createDate };
