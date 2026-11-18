import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkHeartbeat,
  createHeartbeat,
  resolveHeartbeatFilePath,
  runHeartbeatCheck,
} from "../src";

const NOW = 5_000_000;
const MINUTE_MS = 60_000;

const snapshotOf = (pulses: Record<string, { beatAt: number; staleAfterMs: number }>): string =>
  JSON.stringify({ pulses, writtenAt: NOW });

const check = (contents: string | null, at = NOW) =>
  checkHeartbeat({ filePath: "/heartbeat.json", now: () => at, read: () => contents });

const directories: string[] = [];

const createDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "keeper-heartbeat-test-"));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("checkHeartbeat", () => {
  it("passes when no heartbeat was ever recorded", () => {
    expect(check(null)).toEqual({ healthy: true, reason: "absent" });
  });

  it("passes when the file cannot be understood", () => {
    expect(check("{\"pulses\":")).toEqual({ healthy: true, reason: "unreadable" });
    expect(check("[]")).toEqual({ healthy: true, reason: "unreadable" });
    expect(check(JSON.stringify({ pulses: { lane: { beatAt: "soon" } }, writtenAt: NOW })))
      .toEqual({ healthy: true, reason: "unreadable" });
  });

  it("passes when the process started and no loop has progressed yet", () => {
    expect(check(snapshotOf({}), NOW + 24 * 60 * MINUTE_MS)).toEqual({ healthy: true, reason: "fresh" });
  });

  it("passes while every pulse is within its allowance", () => {
    const contents = snapshotOf({
      fleet: { beatAt: NOW - 14 * MINUTE_MS, staleAfterMs: 15 * MINUTE_MS },
      jobs: { beatAt: NOW - MINUTE_MS, staleAfterMs: 15 * MINUTE_MS },
    });

    expect(check(contents)).toEqual({ healthy: true, reason: "fresh" });
  });

  it("passes at exactly the allowance and fails one millisecond past it", () => {
    const contents = snapshotOf({ fleet: { beatAt: NOW, staleAfterMs: 15 * MINUTE_MS } });

    expect(check(contents, NOW + 15 * MINUTE_MS).healthy).toBe(true);
    expect(check(contents, NOW + 15 * MINUTE_MS + 1).healthy).toBe(false);
  });

  it("fails when one pulse is stale even though the others are fresh", () => {
    const contents = snapshotOf({
      fleet: { beatAt: NOW - 16 * MINUTE_MS, staleAfterMs: 15 * MINUTE_MS },
      jobs: { beatAt: NOW, staleAfterMs: 15 * MINUTE_MS },
      wake: { beatAt: NOW, staleAfterMs: 15 * MINUTE_MS },
    });

    expect(check(contents)).toEqual({
      healthy: false,
      stale: [{ ageMs: 16 * MINUTE_MS, name: "fleet", staleAfterMs: 15 * MINUTE_MS }],
    });
  });

  it("passes when the clock moved backwards past a beat", () => {
    const contents = snapshotOf({ fleet: { beatAt: NOW + 60 * MINUTE_MS, staleAfterMs: MINUTE_MS } });

    expect(check(contents).healthy).toBe(true);
  });
});

describe("runHeartbeatCheck", () => {
  it("exits 0 for a file that does not exist", () => {
    const lines: string[] = [];
    const filePath = resolveHeartbeatFilePath("absent", createDirectory());

    expect(runHeartbeatCheck({ filePath }, (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual(["heartbeat absent"]);
  });

  it("exits 0 when the check itself cannot run", () => {
    const lines: string[] = [];
    const exitCode = runHeartbeatCheck(
      {
        filePath: "/heartbeat.json",
        read: () => {
          throw new Error("permission denied");
        },
      },
      (line) => lines.push(line),
    );

    expect(exitCode).toBe(0);
    expect(lines[0]).toContain("could not run");
  });

  it("reads what a heartbeat wrote to disk and follows it from fresh to stale", () => {
    const filePath = resolveHeartbeatFilePath("worker", createDirectory());
    const clock = { at: NOW };
    const heartbeat = createHeartbeat({ filePath, now: () => clock.at });
    const lines: string[] = [];
    const report = (line: string): void => {
      lines.push(line);
    };

    expect(heartbeat.start()).toBe(true);
    heartbeat.beat("queue", 15 * MINUTE_MS);

    expect(runHeartbeatCheck({ filePath, now: () => clock.at + 15 * MINUTE_MS }, report)).toBe(0);
    expect(runHeartbeatCheck({ filePath, now: () => clock.at + 16 * MINUTE_MS }, report)).toBe(1);
    expect(lines.at(-1)).toBe("heartbeat stale: queue last progressed 960000ms ago (allowed 900000ms)");

    clock.at += 16 * MINUTE_MS;
    heartbeat.beat("queue", 15 * MINUTE_MS);

    expect(runHeartbeatCheck({ filePath, now: () => clock.at }, report)).toBe(0);
  });

  it("exits 0 for a file another program left behind", () => {
    const filePath = resolveHeartbeatFilePath("cron", createDirectory());
    writeFileSync(filePath, "not json");

    expect(runHeartbeatCheck({ filePath }, () => null)).toBe(0);
  });
});
