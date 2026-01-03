"use client";

import { createContext, useContext, type ReactNode } from "react";

interface AnalyticsContextValue {
  gdprApplies: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({
  gdprApplies: true,
});

export const useAnalytics = () => useContext(AnalyticsContext);

interface AnalyticsContextProviderProps {
  gdprApplies: boolean;
  children: ReactNode;
}

export const AnalyticsContextProvider = ({
  gdprApplies,
  children,
}: AnalyticsContextProviderProps) => (
  <AnalyticsContext.Provider value={{ gdprApplies }}>
    {children}
  </AnalyticsContext.Provider>
);
