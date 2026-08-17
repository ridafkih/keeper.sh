import type { Fingerprint, ListingScope, SyncCursor } from "@keeper.sh/sync-protocol";

const cursorVersion = 1;
const cursorPrefix = "caldav";
const headSegments = 5;

interface CursorState {
  readonly version: number;
  readonly token: string;
  readonly scopeFingerprint: Fingerprint;
  readonly generation: number;
}

type ParsedCursor =
  | { readonly kind: "usable"; readonly state: CursorState }
  | { readonly kind: "refused"; readonly reason: "version" | "scope" | "malformed" | "superseded" };

const mintCursor = (
  state: CursorState,
  scope: ListingScope,
  hash: (input: string) => string,
): SyncCursor => ({
  kind: "syncCursor",
  value: [
    cursorPrefix,
    String(state.version),
    String(state.generation),
    state.scopeFingerprint.value,
    hash(state.token),
    state.token,
  ].join("/"),
  scope,
});

const parseCursor = (
  cursor: SyncCursor,
  scope: ListingScope,
  fingerprint: Fingerprint,
  hash: (input: string) => string,
): ParsedCursor => {
  const segments = cursor.value.split("/");
  const [prefix, version = null, generation = null, carried = null, digest = null] = segments;
  if (prefix !== cursorPrefix || version === null || generation === null) {
    return { kind: "refused", reason: "malformed" };
  }
  if (Number.parseInt(version, 10) !== cursorVersion) {
    return { kind: "refused", reason: "version" };
  }
  if (carried !== fingerprint.value) {
    return { kind: "refused", reason: "scope" };
  }
  const token = segments.slice(headSegments).join("/");
  if (token.length === 0 || digest !== hash(token)) {
    return { kind: "refused", reason: "malformed" };
  }
  return {
    kind: "usable",
    state: {
      version: cursorVersion,
      token,
      scopeFingerprint: fingerprint,
      generation: Number.parseInt(generation, 10),
    },
  };
};

export { cursorPrefix, cursorVersion, mintCursor, parseCursor };
export type { CursorState, ParsedCursor };
