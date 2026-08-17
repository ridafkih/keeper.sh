import type { CalendarId, IdempotencyKey } from "@keeper.sh/sync-protocol";
import { canonicalise } from "../canonical";

const googleEventIdLimits = { minimumLength: 5, maximumLength: 1024 } as const;

type GoogleEventId =
  | { readonly kind: "eventId"; readonly value: string }
  | { readonly kind: "outOfRange"; readonly length: number };

const base32hexAlphabet = "0123456789abcdefghijklmnopqrstuv";

const symbolAt = (position: number): string => base32hexAlphabet[position] ?? "0";

const base32hexOf = (bytes: Uint8Array): string => {
  const characters: string[] = [];
  const packed = { carried: 0, bits: 0 };
  for (const byte of bytes) {
    packed.carried = packed.carried * 256 + byte;
    packed.bits += 8;
    while (packed.bits >= 5) {
      packed.bits -= 5;
      const divisor = 2 ** packed.bits;
      characters.push(symbolAt(Math.floor(packed.carried / divisor) % 32));
      packed.carried %= divisor;
    }
  }
  if (packed.bits > 0) {
    characters.push(symbolAt((packed.carried * 2 ** (5 - packed.bits)) % 32));
  }
  return characters.join("");
};

const deterministicEventId = (
  idempotencyKey: IdempotencyKey,
  calendar: CalendarId,
  hash: (input: string) => string,
): GoogleEventId => {
  const digest = hash(
    canonicalise({ calendar: calendar.value, idempotencyKey: idempotencyKey.value }),
  );
  const value = base32hexOf(new TextEncoder().encode(digest));
  if (
    value.length < googleEventIdLimits.minimumLength ||
    value.length > googleEventIdLimits.maximumLength
  ) {
    return { kind: "outOfRange", length: value.length };
  }
  return { kind: "eventId", value };
};

export { base32hexOf, deterministicEventId, googleEventIdLimits };
export type { GoogleEventId };
