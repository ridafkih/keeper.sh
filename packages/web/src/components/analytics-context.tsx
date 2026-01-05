"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

interface AnalyticsContextValue {
  gdprApplies: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({
  gdprApplies: true,
});

const useAnalytics = (): AnalyticsContextValue => useContext(AnalyticsContext);

interface AnalyticsContextProviderProps {
  gdprApplies: boolean;
  children: ReactNode;
}

const AnalyticsContextProvider = ({
  gdprApplies,
  children,
}: AnalyticsContextProviderProps): ReactNode => (
  <AnalyticsContext.Provider value={{ gdprApplies }}>{children}</AnalyticsContext.Provider>
);

export { useAnalytics, AnalyticsContextProvider };
