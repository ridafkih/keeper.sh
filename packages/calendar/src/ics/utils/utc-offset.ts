const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;

const offsetPartsToMinutes = (sign: string, hours: string, minutes: string, seconds = "0"): number => {
  const magnitude = Number(hours) * MINUTES_PER_HOUR + Number(minutes) + Number(seconds) / SECONDS_PER_MINUTE;
  if (sign === "-") {
    return -magnitude;
  }
  return magnitude;
};

export { offsetPartsToMinutes };
