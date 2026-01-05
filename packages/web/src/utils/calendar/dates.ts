export const getDaysFromDate = (startDate: Date, count: number): Date[] => {
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(startDate);
    date.setDate(date.getDate() + offset);
    return date;
  });
};

export const isSameDay = (a: Date, b: Date): boolean => {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
};
