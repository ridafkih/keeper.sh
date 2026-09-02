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

/** Re-read on focus like `useNowMinute`, so the today badge and the now line cross midnight together after sleep. */
export function useStartOfToday(): Date {
  const [todayStart, setTodayStart] = useState(resolveStartOfToday);

  useEffect(() => {
    const refresh = () => {
      const next = resolveStartOfToday();
      setTodayStart((previous) => (previous.getTime() === next.getTime() ? previous : next));
    };
    const resync = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timeoutId = globalThis.setTimeout(refresh, resolveMillisecondsUntilTomorrow());
    document.addEventListener("visibilitychange", resync);
    globalThis.addEventListener("focus", resync);

    return () => {
      globalThis.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", resync);
      globalThis.removeEventListener("focus", resync);
    };
  }, [todayStart]);

  return todayStart;
}
