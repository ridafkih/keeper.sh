import type { Fingerprint } from "@keeper.sh/sync-protocol";

interface SourceFingerprint {
  readonly kind: "sourceFingerprint";
  readonly value: Fingerprint;
}

interface MirrorFingerprint {
  readonly kind: "mirrorFingerprint";
  readonly value: Fingerprint;
}

const sourceFingerprintOf = (fingerprint: Fingerprint): SourceFingerprint => ({
  kind: "sourceFingerprint",
  value: fingerprint,
});

const mirrorFingerprintOf = (fingerprint: Fingerprint): MirrorFingerprint => ({
  kind: "mirrorFingerprint",
  value: fingerprint,
});

const sameSource = (left: SourceFingerprint, right: SourceFingerprint): boolean =>
  left.value.value === right.value.value;

const sameMirror = (left: MirrorFingerprint, right: MirrorFingerprint): boolean =>
  left.value.value === right.value.value;

export { mirrorFingerprintOf, sameMirror, sameSource, sourceFingerprintOf };
export type { MirrorFingerprint, SourceFingerprint };
