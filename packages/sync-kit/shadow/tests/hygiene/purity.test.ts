import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { filesMatching } from "../support/sources";
import { runShadow, steadyInput } from "../support/scenario";

const surface = await import("../../src/index");

const callableExportNames = (): readonly string[] =>
  Object.entries(surface).flatMap((entry) => {
    const [name, value] = entry;
    if (typeof value !== "function") {
      return [];
    }
    return [name];
  });

const constructorNameOf = (name: string): string => Reflect.get(surface, name).constructor.name;

const isThenable = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return typeof Reflect.get(value, "then") === "function";
};

const refuse = (): never => {
  throw new Error("the ambient clock was read");
};

const forbidTheAmbientClock = (): (() => void) => {
  const realDate = globalThis.Date;
  class ForbiddenDate {
    constructor() {
      refuse();
    }

    static now(): number {
      return refuse();
    }

    static parse(): number {
      return refuse();
    }

    static UTC(): number {
      return refuse();
    }
  }
  Reflect.set(globalThis, "Date", ForbiddenDate);
  return () => {
    Reflect.set(globalThis, "Date", realDate);
  };
};

const renderedRun = (): string =>
  JSON.stringify(renderCatalog(runShadow(steadyInput()), defaultShadowLimits));

describe("the whole public surface", () => {
  test("SHADOW-L1: no exported function is async", () => {
    for (const name of callableExportNames()) {
      expect(`${name}:${constructorNameOf(name)}`).not.toContain("AsyncFunction");
    }

    const catalog = runShadow(steadyInput());

    expect(isThenable(catalog)).toBe(false);
    expect(catalog).not.toBeInstanceOf(Promise);
    expect(catalog.kind).toBe("cataloged");
  });

  test("SHADOW-L1: the surface is wide enough for this sweep to mean something", () => {
    expect(callableExportNames().length).toBeGreaterThanOrEqual(15);
    expect(runShadow(steadyInput()).kind).toBe("cataloged");
  });

  test("SHADOW-L3: a run succeeds with Date replaced by a throwing class", () => {
    const input = steadyInput();
    const restore = forbidTheAmbientClock();
    try {
      expect(() => runShadow(input)).not.toThrow();
    } finally {
      restore();
    }
  });

  test("SHADOW-L3: no source file references Intl, process.env or toLocale", async () => {
    expect(await filesMatching("src", "Intl.")).toEqual([]);
    expect(await filesMatching("src", "process.env")).toEqual([]);
    expect(await filesMatching("src", "toLocale")).toEqual([]);

    const underUtc = renderedRun();
    const ambient = process.env["TZ"];
    process.env["TZ"] = "Pacific/Kiritimati";
    try {
      expect(renderedRun()).toBe(underUtc);
    } finally {
      process.env["TZ"] = ambient;
    }
  });

  test("SHADOW-L3: a run mutates neither of its two arguments", () => {
    const input = steadyInput();
    const before = JSON.stringify(input);

    runShadow(input);

    expect(JSON.stringify(input)).toBe(before);
  });
});
