import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  createAlwaysRecordSampler,
} from "@opentelemetry/sdk-trace";
import type { Sampler } from "@opentelemetry/sdk-trace";

const createHeadSampler = (sampleRatio: number): Sampler =>
  createAlwaysRecordSampler(
    new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(sampleRatio) }),
  );

export { createHeadSampler };
