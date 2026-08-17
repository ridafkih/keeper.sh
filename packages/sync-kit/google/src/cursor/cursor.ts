import type { Continuation, ListingScope, SyncCursor } from "@keeper.sh/sync-protocol";
import type { ListingMode } from "./fingerprint";
import { listingModes, requestShapeFingerprint } from "./fingerprint";

const cursorVersion = 1;

interface CursorContents {
  readonly version: number;
  readonly mode: ListingMode;
  readonly windowFingerprint: string;
  readonly providerToken: string;
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
  return btoa(characters.join(""))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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
  if (typeof carrier.windowFingerprint !== "string" || typeof carrier.providerToken !== "string") {
    return null;
  }
  return {
    version: carrier.version,
    mode,
    windowFingerprint: carrier.windowFingerprint,
    providerToken: carrier.providerToken,
  };
};

const encodeCursorValue = (contents: CursorContents): string =>
  base64UrlOf(
    JSON.stringify({
      version: contents.version,
      mode: contents.mode,
      windowFingerprint: contents.windowFingerprint,
      providerToken: contents.providerToken,
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

const mintCursor = (
  scope: ListingScope,
  providerToken: string,
  options: CursorOptions,
): SyncCursor => ({
  kind: "syncCursor",
  value: encodeCursorValue({
    version: cursorVersion,
    mode: "delta",
    windowFingerprint: requestShapeFingerprint(scope, "delta", options.hash),
    providerToken,
  }),
  scope,
});

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
  if (contents.windowFingerprint !== requestShapeFingerprint(scope, contents.mode, options.hash)) {
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
  pageToken: string,
  options: CursorOptions,
): Continuation => ({
  kind: "continuation",
  value: encodeCursorValue({
    version: cursorVersion,
    mode: "snapshot",
    windowFingerprint: requestShapeFingerprint(scope, "snapshot", options.hash),
    providerToken: pageToken,
  }),
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
  parseContinuation,
  parseCursor,
};
export type { CursorContents, CursorOptions, CursorReading };
