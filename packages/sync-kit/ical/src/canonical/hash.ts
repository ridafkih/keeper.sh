import type { Fingerprint } from "@keeper.sh/sync-protocol";
import { eventIdentityKey } from "../parse/identity";
import type { CanonicalEvent } from "./canonical-event";
import { encodeCanonicalEvent, fieldSeparator } from "./encode";

const canonicalEventFingerprint = (event: CanonicalEvent): Fingerprint => ({
  kind: "fingerprint",
  value: new Bun.CryptoHasher("sha256")
    .update(`${eventIdentityKey(event.identity)}${fieldSeparator}${encodeCanonicalEvent(event)}`)
    .digest("hex"),
});

export { canonicalEventFingerprint };
