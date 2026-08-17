import type { Fingerprint, ListingScope } from "@keeper.sh/sync-protocol";

const scopeKeyOf = (scope: ListingScope): string =>
  [
    scope.calendar.provider,
    scope.calendar.account.value,
    scope.calendar.calendar.value,
    scope.window.start.value,
    scope.window.end.value,
  ].join("|");

const scopeFingerprint = (scope: ListingScope, hash: (input: string) => string): Fingerprint => ({
  kind: "fingerprint",
  value: hash(scopeKeyOf(scope)),
});

export { scopeFingerprint, scopeKeyOf };
