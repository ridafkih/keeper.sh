const formatTimeUntil = (date: Date): string => {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / (1000 * 60));

  if (diffMins === 0) return "now";

  const absMins = Math.abs(diffMins);
  const suffix = diffMins < 0 ? " ago" : "";
  const prefix = diffMins > 0 ? "in " : "";

  if (absMins < 60) return `${prefix}${absMins}m${suffix}`;

  const hours = Math.floor(absMins / 60);
  return `${prefix}${hours}h${suffix}`;
};

const isEventPast = (endTime: Date): boolean => {
  return endTime.getTime() < Date.now();
};

export { formatTimeUntil, isEventPast };
