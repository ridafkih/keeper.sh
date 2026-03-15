import type { ScopedMutator } from "swr";

/**
 * Revalidate all account and source caches.
 * Use after creating, updating, or deleting accounts/sources.
 */
export function invalidateAccountsAndSources(
  globalMutate: ScopedMutator,
  ...additionalKeys: string[]
) {
  return Promise.all([
    globalMutate("/api/accounts"),
    globalMutate("/api/sources"),
    ...additionalKeys.map((key) => globalMutate(key)),
  ]);
}
