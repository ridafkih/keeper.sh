import { useCallback, useEffect, useRef, useState } from "react";

const TICK_MS = 1000;
const NO_TIME_REMAINING = 0;

/*
 * Deadline based, so a throttled or backgrounded tab resumes on the real
 * remainder instead of however many ticks the browser chose to deliver.
 */
export const useCountdown = () => {
  const [secondsRemaining, setSecondsRemaining] = useState(NO_TIME_REMAINING);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef(NO_TIME_REMAINING);

  const clearTicking = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => clearTicking, [clearTicking]);

  useEffect(() => {
    if (secondsRemaining === NO_TIME_REMAINING) clearTicking();
  }, [secondsRemaining, clearTicking]);

  const start = useCallback((seconds: number) => {
    clearTicking();

    if (seconds <= NO_TIME_REMAINING) {
      setSecondsRemaining(NO_TIME_REMAINING);
      return;
    }

    deadlineRef.current = Date.now() + seconds * TICK_MS;
    setSecondsRemaining(seconds);
    intervalRef.current = setInterval(() => {
      setSecondsRemaining(Math.max(
        Math.ceil((deadlineRef.current - Date.now()) / TICK_MS),
        NO_TIME_REMAINING,
      ));
    }, TICK_MS);
  }, [clearTicking]);

  return { secondsRemaining, start };
};
