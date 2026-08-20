import type { BoundedSample } from "@keeper.sh/sync-protocol";
import type { PlanLimits } from "../policy";

const boundedSample = (values: readonly string[], limits: PlanLimits): BoundedSample => {
  const encoder = new TextEncoder();
  const sample: string[] = [];
  const budget = { bytes: 0 };
  for (const value of values) {
    if (sample.length >= limits.sampleCount) {
      break;
    }
    const size = encoder.encode(value).length;
    if (budget.bytes + size > limits.sampleBytes) {
      break;
    }
    sample.push(value);
    budget.bytes += size;
  }
  return { sample, total: values.length };
};

export { boundedSample };
