import { useCallback, useSyncExternalStore } from "react";
import { resolveEffectiveConsent, subscribeToConsentChanges } from "@/lib/analytics";
import { useGdprApplies } from "./use-gdpr-applies";

const getServerSnapshot = (): boolean => false;

export function useEffectiveConsent(): boolean {
  const gdprApplies = useGdprApplies();
  const getSnapshot = useCallback(() => resolveEffectiveConsent(gdprApplies), [gdprApplies]);

  return useSyncExternalStore(subscribeToConsentChanges, getSnapshot, getServerSnapshot);
}
