import type { Fingerprint, ListChangesRequest } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import type { ContinuationState } from "../cursor/continuation";
import { parseContinuation } from "../cursor/continuation";
import type { CursorState } from "../cursor/cursor";
import { parseCursor } from "../cursor/cursor";

type ListingMode =
  | { readonly kind: "snapshot" }
  | { readonly kind: "resumeSnapshot"; readonly state: ContinuationState }
  | { readonly kind: "delta"; readonly state: CursorState }
  | { readonly kind: "resumeDelta"; readonly state: ContinuationState }
  | { readonly kind: "cursorLost" };

const resumedMode = (state: ContinuationState): ListingMode => {
  switch (state.mode) {
    case "resumeSnapshot": {
      return { kind: "resumeSnapshot", state };
    }
    case "resumeDelta": {
      return { kind: "resumeDelta", state };
    }
    default: {
      return assertNever(state.mode);
    }
  }
};

const resolveListingMode = (
  request: ListChangesRequest,
  fingerprint: Fingerprint,
  hash: (input: string) => string,
): ListingMode => {
  const { resume } = request;
  if (resume === null) {
    return { kind: "snapshot" };
  }
  if (resume.kind === "continuation") {
    const parsed = parseContinuation(resume, request.scope, fingerprint);
    if (parsed.kind === "refused") {
      return { kind: "cursorLost" };
    }
    return resumedMode(parsed.state);
  }
  const parsed = parseCursor(resume, request.scope, fingerprint, hash);
  if (parsed.kind === "refused") {
    return { kind: "cursorLost" };
  }
  return { kind: "delta", state: parsed.state };
};

export { resolveListingMode };
export type { ListingMode };
