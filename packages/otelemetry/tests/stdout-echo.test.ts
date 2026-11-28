import { describe, expect, it } from "vitest";
import { isEchoedToStdout, readStdoutEchoLevel } from "../src/stdout-echo";

describe("readStdoutEchoLevel", () => {
  it.each([
    ["trace", 10],
    ["debug", 20],
    ["info", 30],
    ["warn", 40],
    ["error", 50],
    ["fatal", 60],
  ])("reads %s as the pino level %i", (name, level) => {
    expect(readStdoutEchoLevel({ STDOUT_LOG_LEVEL: name })).toBe(level);
  });

  it("refuses to forward logs without a stdout level instead of echoing everything", () => {
    expect(() => readStdoutEchoLevel({})).toThrow(/STDOUT_LOG_LEVEL/);
  });

  it("refuses a level pino does not have", () => {
    expect(() => readStdoutEchoLevel({ STDOUT_LOG_LEVEL: "verbose" })).toThrow(/STDOUT_LOG_LEVEL/);
  });
});

describe("isEchoedToStdout", () => {
  const warn = readStdoutEchoLevel({ STDOUT_LOG_LEVEL: "warn" });

  it("keeps info and below off stdout once they go to the collector", () => {
    expect(isEchoedToStdout(10, warn)).toBe(false);
    expect(isEchoedToStdout(20, warn)).toBe(false);
    expect(isEchoedToStdout(30, warn)).toBe(false);
  });

  it("echoes the threshold level and above", () => {
    expect(isEchoedToStdout(40, warn)).toBe(true);
    expect(isEchoedToStdout(50, warn)).toBe(true);
    expect(isEchoedToStdout(60, warn)).toBe(true);
  });

  it("echoes lines whose level it cannot rank, such as a crash trace on stderr", () => {
    expect(isEchoedToStdout(null, warn)).toBe(true);
    expect(isEchoedToStdout("info", warn)).toBe(true);
  });
});
