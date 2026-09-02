import { useEffect, useState } from "react";

const MS_PER_MINUTE = 60_000;

/** Null until mounted so SSR and hydration agree; re-read on focus since throttled tabs deliver late ticks. */
export function useNowMinute(): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(new Date());
      timeoutId = globalThis.setTimeout(tick, MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE));
    };
    const resync = () => {
      if (document.visibilityState !== "visible") return;
      globalThis.clearTimeout(timeoutId);
      tick();
    };
    tick();
    document.addEventListener("visibilitychange", resync);
    globalThis.addEventListener("focus", resync);

    return () => {
      globalThis.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", resync);
      globalThis.removeEventListener("focus", resync);
    };
  }, []);

  return now;
}
