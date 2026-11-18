import { afterAll, describe, expect, it } from "vitest";

const FIXTURE = new URL("../fixtures/emit-traced-wide-event.ts", import.meta.url).pathname;

const collector = Bun.serve({ port: 0, fetch: () => Response.json({}) });

afterAll(() => {
  collector.stop(true);
});

const runFixture = async () => {
  const fixture = Bun.spawn(["bun", FIXTURE], {
    env: {
      ...process.env,
      ENV: "production",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${collector.port}`,
      TRACE_SAMPLE_RATIO: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([new Response(fixture.stdout).text(), new Response(fixture.stderr).text()]);
  await fixture.exited;
  const wideEvents = stdout.trim().split("\n").map((line) => JSON.parse(line));
  const [activeSpan] = stderr.trim().split("\n").map((line) => JSON.parse(line));
  return { activeSpan, wideEvents };
};

describe("wide events inside a traced request", () => {
  it("carry the request's trace and span ids on every event the context flushes", async () => {
    const { activeSpan, wideEvents } = await runFixture();
    expect(activeSpan.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(wideEvents).toHaveLength(2);
    for (const wideEvent of wideEvents) {
      expect(wideEvent).toMatchObject({ trace_id: activeSpan.trace_id, span_id: activeSpan.span_id });
    }
  });
});
