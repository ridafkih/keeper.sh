import type { Continuation, Fingerprint, ListingScope } from "@keeper.sh/sync-protocol";
import { cursorPrefix, cursorVersion } from "./cursor";

const continuationModes = ["resumeSnapshot", "resumeDelta"] as const;
type ContinuationMode = (typeof continuationModes)[number];

const absentToken = "-";
const headSegments = 5;

interface ContinuationState {
  readonly version: number;
  readonly mode: ContinuationMode;
  readonly token: string;
  readonly cursorToken: string | null;
  readonly scopeFingerprint: Fingerprint;
}

type ParsedContinuation =
  | { readonly kind: "usable"; readonly state: ContinuationState }
  | { readonly kind: "refused"; readonly reason: "version" | "scope" | "malformed" };

const encodedToken = (token: string | null): string => {
  if (token === null) {
    return absentToken;
  }
  return encodeURIComponent(token);
};

const decodedToken = (segment: string): string | null => {
  if (segment === absentToken) {
    return null;
  }
  return decodeURIComponent(segment);
};

const mintContinuation = (state: ContinuationState, scope: ListingScope): Continuation => ({
  kind: "continuation",
  value: [
    cursorPrefix,
    String(state.version),
    state.mode,
    state.scopeFingerprint.value,
    encodedToken(state.cursorToken),
    state.token,
  ].join("/"),
  scope,
});

const modeOf = (segment: string | null): ContinuationMode | null =>
  continuationModes.find((mode) => mode === segment) ?? null;

const parseContinuation = (
  continuation: Continuation,
  scope: ListingScope,
  fingerprint: Fingerprint,
): ParsedContinuation => {
  const segments = continuation.value.split("/");
  const [prefix, version = null, rawMode = null, carried = null, cursorToken = null] = segments;
  if (prefix !== cursorPrefix || version === null) {
    return { kind: "refused", reason: "malformed" };
  }
  if (Number.parseInt(version, 10) !== cursorVersion) {
    return { kind: "refused", reason: "version" };
  }
  const mode = modeOf(rawMode);
  if (mode === null || cursorToken === null) {
    return { kind: "refused", reason: "malformed" };
  }
  if (carried !== fingerprint.value) {
    return { kind: "refused", reason: "scope" };
  }
  return {
    kind: "usable",
    state: {
      version: cursorVersion,
      mode,
      token: segments.slice(headSegments).join("/"),
      cursorToken: decodedToken(cursorToken),
      scopeFingerprint: fingerprint,
    },
  };
};

export { continuationModes, mintContinuation, parseContinuation };
export type { ContinuationMode, ContinuationState, ParsedContinuation };
