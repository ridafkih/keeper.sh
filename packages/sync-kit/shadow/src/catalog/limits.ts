interface ShadowLimits {
  readonly deletionSampleCount: number;
  readonly deletionSampleBytes: number;
  readonly contextSampleCount: number;
  readonly contextSampleBytes: number;
  readonly identifierBytes: number;
}

const defaultShadowLimits: ShadowLimits = {
  deletionSampleCount: 200,
  deletionSampleBytes: 65_536,
  contextSampleCount: 32,
  contextSampleBytes: 4096,
  identifierBytes: 256,
};

const truncationMarker = "…";

export { defaultShadowLimits, truncationMarker };
export type { ShadowLimits };
