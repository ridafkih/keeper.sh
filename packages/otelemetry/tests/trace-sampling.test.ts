import { afterEach, describe, expect, it } from "vitest";
import { withSpan } from "../src/tracing/spans";
import { startTracingHarness } from "./tracing-harness";

let harness: ReturnType<typeof startTracingHarness> | null = null;

afterEach(async () => {
  await harness?.stop();
  harness = null;
});

const start = (options: Parameters<typeof startTracingHarness>[0]) => {
  harness = startTracingHarness(options);
  return harness;
};

describe("head sampling with error and slow retention", () => {
  it("exports every span of a sampled trace", async () => {
    const tracing = start({ sampleRatio: 1 });
    await withSpan("job", {}, () => withSpan("provider call", {}, () => Promise.resolve()));
    const spans = await tracing.exportedSpans();
    const names = spans.map((span) => span.name);
    expect(names.toSorted()).toEqual(["job", "provider call"]);
  });

  it("discards an unsampled trace that succeeded quickly", async () => {
    const tracing = start({ sampleRatio: 0 });
    await withSpan("job", {}, () => withSpan("provider call", {}, () => Promise.resolve()));
    expect(await tracing.exportedSpans()).toEqual([]);
  });

  it("keeps an unsampled trace whose root failed, children included", async () => {
    const tracing = start({ sampleRatio: 0 });
    const failingJob = withSpan("job", {}, async () => {
      await withSpan("provider call", {}, () => Promise.resolve());
      throw new Error("provider rejected the write");
    });
    await expect(failingJob).rejects.toThrow("provider rejected the write");
    const spans = await tracing.exportedSpans();
    const names = spans.map((span) => span.name);
    expect(names.toSorted()).toEqual(["job", "provider call"]);
  });

  it("keeps an unsampled trace whose root was slow", async () => {
    const tracing = start({ sampleRatio: 0, slowThresholdMillis: 20 });
    await withSpan("job", {}, () => Bun.sleep(30));
    const spans = await tracing.exportedSpans();
    const names = spans.map((span) => span.name);
    expect(names).toEqual(["job"]);
  });
});
