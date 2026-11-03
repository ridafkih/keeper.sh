import type { ScopedMutator } from "swr";

const EVENTS_KEY_PATTERN = /^(\$inf\$)?\/api\/events/;

export function isEventsKey(key: unknown): boolean {
  return typeof key === "string" && EVENTS_KEY_PATTERN.test(key);
}

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
    globalMutate(isEventsKey),
    ...additionalKeys.map((key) => globalMutate(key)),
  ]);
}
