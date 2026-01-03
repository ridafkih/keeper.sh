"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useSyncExternalStore } from "react";
import { hasAnalyticsConsent, track } from "@/lib/analytics";

const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
};

interface AnalyticsProviderProps {
  token: string;
  gdprApplies: boolean;
}

export const AnalyticsProvider = ({
  token,
  gdprApplies,
}: AnalyticsProviderProps) => {
  const pathname = usePathname();
  const hasConsent = useSyncExternalStore(
    subscribe,
    () => hasAnalyticsConsent(),
    () => false,
  );

  const persist = !gdprApplies || hasConsent;

  useEffect(() => {
    track("page_view", { path: pathname });
  }, [pathname]);

  return (
    <Script
      key={persist ? "persist" : "no-persist"}
      src="https://cdn.visitors.now/v.js"
      data-token={token}
      {...(persist && { "data-persist": true })}
    />
  );
};
