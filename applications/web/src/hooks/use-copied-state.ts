import { useCallback, useEffect, useRef, useState } from "react";

const COPIED_RESET_MS = 2000;

/*
 * Spamming the button restarts the window instead of letting an earlier timer
 * clear the indicator while a later copy is still fresh.
 */
export const useCopiedState = (resetMs: number = COPIED_RESET_MS) => {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPendingReset = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  useEffect(() => clearPendingReset, [clearPendingReset]);

  const markCopied = useCallback(() => {
    clearPendingReset();
    setCopied(true);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setCopied(false);
    }, resetMs);
  }, [clearPendingReset, resetMs]);

  return { copied, markCopied };
};
