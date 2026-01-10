const MINS_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const MINS_PER_DAY = MINS_PER_HOUR * HOURS_PER_DAY;

const formatTimeUntil = (date: Date): string => {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffMins = Math.round(diffMs / (1000 * 60));

  if (diffMins === 0) return "now";

  const absMins = Math.abs(diffMins);
  const suffix = diffMins < 0 ? " ago" : "";
  const prefix = diffMins > 0 ? "in " : "";

  if (absMins < MINS_PER_HOUR) return `${prefix}${absMins}m${suffix}`;

  const hours = Math.floor(absMins / MINS_PER_HOUR);
  if (hours < 48) return `${prefix}${hours}h${suffix}`;

  const days = Math.floor(absMins / MINS_PER_DAY);
  return `${prefix}${days}d${suffix}`;
};

const isEventPast = (endTime: Date): boolean => {
  return endTime.getTime() < Date.now();
};

export { formatTimeUntil, isEventPast };
