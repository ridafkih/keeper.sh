import type { ProviderFailure } from "./provider-failure";

type Result<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: ProviderFailure };

export type { Result };
