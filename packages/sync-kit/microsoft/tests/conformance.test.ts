import {
  conformanceCaseIds,
  conformanceHash,
  createConformanceEnvironment,
  runConformance,
} from "@keeper.sh/sync-conformance";
import { describe, expect, it, test } from "vitest";
import { microsoftCapabilities } from "../src/capabilities";
import { withinMicrosoftWindow } from "../src/window/membership";
import { createMicrosoftUnderTest } from "./support/provider-under-test";

const report = runConformance(
  { describe, it },
  {
    name: "microsoft",
    supports: microsoftCapabilities,
    create: createMicrosoftUnderTest,
    withinWindow: withinMicrosoftWindow,
  },
);

describe("the conformance suite is the acceptance gate for @keeper.sh/sync-microsoft", () => {
  test("MS-C1: every case the capability declaration gates on is selected and runnable", async () => {
    const selected = new Set(report.selected.map((entry) => entry.id));
    const missing = report.ungated.filter((id) => !selected.has(id));
    const environment = createConformanceEnvironment({
      start: { kind: "instant", value: "2026-03-11T00:00:00.000Z" },
      installation: { kind: "installationId", value: "conformance-microsoft" },
      hash: conformanceHash,
    });

    const underTest = await createMicrosoftUnderTest(environment);

    expect(missing).toEqual([]);
    expect(report.selected.length).toBe(conformanceCaseIds.length);
    expect(underTest.contract.provider.capabilities).toEqual(microsoftCapabilities);
  });
});
