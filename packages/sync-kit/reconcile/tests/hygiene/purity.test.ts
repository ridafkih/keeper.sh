import { describe, expect, test } from "vitest";
import { planFor, steadyScenario } from "../support/scenario";

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
  }
  Reflect.set(globalThis, "Date", ForbiddenDate);
  return () => {
    Reflect.set(globalThis, "Date", realDate);
  };
};

describe("the whole public surface", () => {
  test("RECON-L1: no export is declared async and the planner returns a plain value", () => {
    for (const name of callableExportNames()) {
      expect(`${name}:${constructorNameOf(name)}`).not.toContain("AsyncFunction");
    }

    const plan = planFor(steadyScenario());

    expect(isThenable(plan)).toBe(false);
    expect(plan).not.toBeInstanceOf(Promise);
  });

  test("RECON-L1: the planner completes rather than handing back a pending seam", () => {
    expect(() => planFor(steadyScenario())).not.toThrow();
    expect(planFor(steadyScenario()).cursor.kind).toBe("hold");
  });

  test("RECON-L1: the surface is wide enough for this sweep to mean something", () => {
    expect(callableExportNames().length).toBeGreaterThanOrEqual(20);
  });

  test("RECON-L3: planning never reads the ambient clock", () => {
    const scenario = steadyScenario();
    const restore = forbidTheAmbientClock();
    try {
      expect(() => planFor(scenario)).not.toThrow();
    } finally {
      restore();
    }
  });

  test("RECON-L3: two plans built from one input are byte-for-byte identical", () => {
    const scenario = steadyScenario();

    expect(JSON.stringify(planFor(scenario))).toBe(JSON.stringify(planFor(scenario)));
  });

  test("RECON-I44: the plan is identical under UTC and under a zone fourteen hours ahead", () => {
    const scenario = steadyScenario();
    const underUtc = JSON.stringify(planFor(scenario));
    const ambient = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati";
    try {
      expect(JSON.stringify(planFor(scenario))).toBe(underUtc);
    } finally {
      process.env.TZ = ambient;
    }
  });

  test("RECON-I44: no module under src reads a zone or a locale from the environment", async () => {
    const { filesMatching } = await import("../support/sources");

    expect(await filesMatching("src", "Intl.")).toEqual([]);
    expect(await filesMatching("src", "process.env")).toEqual([]);
    expect(await filesMatching("src", "toLocale")).toEqual([]);
  });

  test("RECON-L3: planning mutates none of its four arguments", () => {
    const scenario = steadyScenario();
    const before = JSON.stringify(scenario);

    planFor(scenario);

    expect(JSON.stringify(scenario)).toBe(before);
  });
});
