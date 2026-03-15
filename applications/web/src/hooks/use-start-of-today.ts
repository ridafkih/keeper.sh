import { useEffect, useState } from "react";

function resolveStartOfToday(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function resolveMillisecondsUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  return tomorrow.getTime() - now.getTime();
}

export function useStartOfToday(): Date {
  const [todayStart, setTodayStart] = useState(resolveStartOfToday);

  useEffect(() => {
    const timeoutId = globalThis.setTimeout(() => {
      setTodayStart(resolveStartOfToday());
    }, resolveMillisecondsUntilTomorrow());

    return () => {
      globalThis.clearTimeout(timeoutId);
    };
  }, [todayStart]);

  return todayStart;
}
