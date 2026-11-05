import type { Fingerprint, RemoteVersion } from "./handles";

type Precondition =
  | { readonly kind: "matchesVersion"; readonly version: RemoteVersion }
  | { readonly kind: "matchesFingerprint"; readonly fingerprint: Fingerprint }
  | { readonly kind: "absent" };

type PreconditionKind = Precondition["kind"];

type ObservedPrecondition = Exclude<Precondition, { kind: "absent" }>;

export type { ObservedPrecondition, Precondition, PreconditionKind };
