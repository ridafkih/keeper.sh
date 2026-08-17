import type { Continuation, ListingScope, SyncCursor } from "@keeper.sh/sync-protocol";
import type { ListingMode } from "./fingerprint";
import { listingModes, requestShapeFingerprint } from "./fingerprint";

const cursorVersion = 1;

interface CursorContents {
  readonly version: number;
  readonly mode: ListingMode;
  readonly scopeFingerprint: string;
  readonly providerLink: string;
}

type CursorReading =
  | { readonly kind: "usable"; readonly contents: CursorContents }
  | { readonly kind: "unreadable" };

interface CursorOptions {
  readonly hash: (input: string) => string;
}

const base64UrlOf = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  const characters: string[] = [];
  for (const byte of bytes) {
    characters.push(String.fromCodePoint(byte));
  }
  return btoa(characters.join("")).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const textOfBase64Url = (value: string): string | null => {
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const modeOf = (value: unknown): ListingMode | null =>
  listingModes.find((mode) => mode === value) ?? null;

const contentsOf = (value: unknown): CursorContents | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const carrier: Record<string, unknown> = { ...value };
  const mode = modeOf(carrier.mode);
  if (typeof carrier.version !== "number" || mode === null) {
    return null;
  }
  if (
    typeof carrier.scopeFingerprint !== "string" ||
    typeof carrier.providerLink !== "string"
  ) {
    return null;
  }
  return {
    version: carrier.version,
    mode,
    scopeFingerprint: carrier.scopeFingerprint,
    providerLink: carrier.providerLink,
  };
};

const encodeCursorValue = (contents: CursorContents): string =>
  base64UrlOf(
    JSON.stringify({
      version: contents.version,
      mode: contents.mode,
      scopeFingerprint: contents.scopeFingerprint,
      providerLink: contents.providerLink,
    }),
  );

const decodeCursorValue = (value: string): CursorReading => {
  if (value.length === 0) {
    return { kind: "unreadable" };
  }
  const text = textOfBase64Url(value);
  if (text === null) {
    return { kind: "unreadable" };
  }
  const contents = contentsOf(parsedJson(text));
  if (contents === null) {
    return { kind: "unreadable" };
  }
  return { kind: "usable", contents };
};

const mintedValue = (
  scope: ListingScope,
  mode: ListingMode,
  providerLink: string,
  options: CursorOptions,
): string =>
  encodeCursorValue({
    version: cursorVersion,
    mode,
    scopeFingerprint: requestShapeFingerprint(scope, mode, options.hash),
    providerLink,
  });

const mintCursorIn = (
  scope: ListingScope,
  mode: ListingMode,
  providerLink: string,
  options: CursorOptions,
): SyncCursor => ({
  kind: "syncCursor",
  value: mintedValue(scope, mode, providerLink, options),
  scope,
});

const mintCursor = (scope: ListingScope, providerLink: string, options: CursorOptions): SyncCursor =>
  mintCursorIn(scope, "delta", providerLink, options);

const readingBoundTo = (
  reading: CursorReading,
  scope: ListingScope,
  options: CursorOptions,
): CursorReading => {
  if (reading.kind === "unreadable") {
    return reading;
  }
  const { contents } = reading;
  if (contents.version !== cursorVersion) {
    return { kind: "unreadable" };
  }
  if (contents.scopeFingerprint !== requestShapeFingerprint(scope, contents.mode, options.hash)) {
    return { kind: "unreadable" };
  }
  return reading;
};

const parseCursor = (
  cursor: SyncCursor,
  scope: ListingScope,
  options: CursorOptions,
): CursorReading => readingBoundTo(decodeCursorValue(cursor.value), scope, options);

const mintContinuation = (
  scope: ListingScope,
  providerLink: string,
  options: CursorOptions,
): Continuation => ({
  kind: "continuation",
  value: mintedValue(scope, "snapshot", providerLink, options),
  scope,
});

const parseContinuation = (
  continuation: Continuation,
  scope: ListingScope,
  options: CursorOptions,
): CursorReading => readingBoundTo(decodeCursorValue(continuation.value), scope, options);

export {
  cursorVersion,
  decodeCursorValue,
  encodeCursorValue,
  mintContinuation,
  mintCursor,
  mintCursorIn,
  parseContinuation,
  parseCursor,
};
export type { CursorContents, CursorOptions, CursorReading };
