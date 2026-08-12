import { useEffect, useSyncExternalStore } from "react";
import { gdprApplies, resolveGdprApplies, subscribeToGdprChanges } from "@/lib/gdpr-consent";

const getServerSnapshot = (): boolean => true;

export function useGdprApplies(): boolean {
  useEffect(() => {
    resolveGdprApplies();
  }, []);

  return useSyncExternalStore(subscribeToGdprChanges, gdprApplies, getServerSnapshot);
}
