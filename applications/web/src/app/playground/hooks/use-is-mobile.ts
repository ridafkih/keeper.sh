"use client";

import { useSyncExternalStore } from "react";

const MOBILE_BREAKPOINT = 640;

const getServerSnapshot = () => false;

const useIsMobile = () => {
  const subscribe = (callback: () => void) => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    mediaQuery.addEventListener("change", callback);
    return () => mediaQuery.removeEventListener("change", callback);
  };

  const getSnapshot = () =>
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};

export { useIsMobile };
