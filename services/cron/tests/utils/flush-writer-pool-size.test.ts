import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FlushWriterModule {
  FLUSH_WRITER_CONNECTIONS: number;
  DEFAULT_FLUSH_WRITER_CONNECTIONS: number;
}

const loadFlushWriter = (): Promise<FlushWriterModule> => {
  vi.resetModules();
  return import("../../src/utils/flush-writer");
};

describe("flush writer pool size", () => {
  const original = process.env.CRON_FLUSH_POOL_MAX;

  beforeEach(() => {
    delete process.env.CRON_FLUSH_POOL_MAX;
  });

  afterEach(() => {
    if (typeof original === "string") {
      process.env.CRON_FLUSH_POOL_MAX = original;
      return;
    }
    delete process.env.CRON_FLUSH_POOL_MAX;
  });

  it("defaults to the production-sized pool when unset", async () => {
    const { FLUSH_WRITER_CONNECTIONS, DEFAULT_FLUSH_WRITER_CONNECTIONS } = await loadFlushWriter();
    expect(FLUSH_WRITER_CONNECTIONS).toBe(DEFAULT_FLUSH_WRITER_CONNECTIONS);
  });

  it("takes its size from CRON_FLUSH_POOL_MAX", async () => {
    process.env.CRON_FLUSH_POOL_MAX = "8";
    const { FLUSH_WRITER_CONNECTIONS } = await loadFlushWriter();
    expect(FLUSH_WRITER_CONNECTIONS).toBe(8);
  });
});
