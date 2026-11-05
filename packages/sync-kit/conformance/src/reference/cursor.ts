import type { Instant, ListingScope, SyncCursor } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";

type CursorVerdict =
  | { readonly kind: "current"; readonly sequence: number }
  | { readonly kind: "superseded" }
  | { readonly kind: "foreignScope" }
  | { readonly kind: "unknown" };

interface MintedCursor {
  readonly scopeKey: string;
  readonly sequence: number;
  readonly generation: number;
}

interface CursorMint {
  readonly mint: (scope: ListingScope, sequence: number, at: Instant) => SyncCursor;
  readonly verify: (cursor: SyncCursor, scope: ListingScope) => CursorVerdict;
  readonly generations: () => number;
}

const scopeKeyOf = (scope: ListingScope): string =>
  canonicalise({
    provider: scope.calendar.provider,
    account: scope.calendar.account.value,
    calendar: scope.calendar.calendar.value,
    start: scope.window.start.value,
    end: scope.window.end.value,
    expandRecurrences: scope.expandRecurrences,
  });

const createCursorMint = (hash: (input: string) => string): CursorMint => {
  const minted = new Map<string, MintedCursor>();
  const latest = new Map<string, number>();
  const counter = { generation: 0 };

  const mint = (scope: ListingScope, sequence: number, at: Instant): SyncCursor => {
    counter.generation += 1;
    const scopeKey = scopeKeyOf(scope);
    const { generation } = counter;
    const value = `${hash(`reference-cursor|${scopeKey}|${at.value}`)}.${generation}`;
    minted.set(value, { scopeKey, sequence, generation });
    latest.set(scopeKey, generation);
    return { kind: "syncCursor", value, scope };
  };

  const verify = (cursor: SyncCursor, scope: ListingScope): CursorVerdict => {
    const record = minted.get(cursor.value);
    if (!record) {
      return { kind: "unknown" };
    }
    if (record.scopeKey !== scopeKeyOf(scope)) {
      return { kind: "foreignScope" };
    }
    if (latest.get(record.scopeKey) !== record.generation) {
      return { kind: "superseded" };
    }
    return { kind: "current", sequence: record.sequence };
  };

  return { mint, verify, generations: () => counter.generation };
};

export { createCursorMint, scopeKeyOf };
export type { CursorMint, CursorVerdict };
