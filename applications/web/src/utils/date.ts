const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatIsoDate(isoDate: string): string {
  const [yearPart, monthPart, dayPart] = isoDate.split("-");
  const monthName = monthNames[Number(monthPart) - 1];
  return `${monthName} ${Number(dayPart)}, ${yearPart}`;
}
