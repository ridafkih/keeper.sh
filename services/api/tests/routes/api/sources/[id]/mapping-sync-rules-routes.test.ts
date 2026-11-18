import { NO_SYNC_RULE_OVERRIDES, resolveSyncRules } from "@keeper.sh/data-schemas";
import type { SyncRuleOverrides, SyncRules } from "@keeper.sh/data-schemas";
import { describe, expect, it } from "vitest";
import {
  handleGetMappingSyncRulesRoute,
  handlePatchMappingSyncRulesRoute,
} from "../../../../../src/routes/api/sources/[id]/mapping-sync-rules-routes";
import type { PatchMappingSyncRulesDependencies } from "../../../../../src/routes/api/sources/[id]/mapping-sync-rules-routes";
import type { MappingSyncRules, MappingSyncRuleUpdates } from "@/utils/mapping-sync-rules";
import { MAPPING_LIMIT_ERROR_MESSAGE } from "@/utils/source-destination-mappings";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DESTINATION_ID = "22222222-2222-4222-8222-222222222222";
const PARAMS = { destinationId: DESTINATION_ID, id: SOURCE_ID };

const SOURCE_RULES: SyncRules = {
  customEventName: "{{calendar_name}}",
  disableEventReminders: false,
  excludeAllDayEvents: false,
  excludeAvailabilities: [],
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventName: true,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: [],
  markEventsAsPrivate: false,
};

const createMapping = (
  overrides: Partial<SyncRuleOverrides> = {},
  sourceProvider = "google",
): MappingSyncRules => {
  const mergedOverrides = { ...NO_SYNC_RULE_OVERRIDES, ...overrides };
  return {
    destinationCalendarId: DESTINATION_ID,
    effectiveRules: resolveSyncRules(SOURCE_RULES, mergedOverrides),
    includeUpstreamSources: false,
    overrides: mergedOverrides,
    sourceCalendarId: SOURCE_ID,
    sourceProvider,
    sourceRules: SOURCE_RULES,
  };
};

interface PatchHarness {
  dependencies: PatchMappingSyncRulesDependencies;
  appliedUpdates: MappingSyncRuleUpdates[];
  entitlementChecks: string[];
}

const createPatchHarness = (options: {
  mapping?: MappingSyncRules | null;
  canUseEventFilters?: boolean;
  disappearsBeforeWrite?: boolean;
} = {}): PatchHarness => {
  const appliedUpdates: MappingSyncRuleUpdates[] = [];
  const entitlementChecks: string[] = [];
  let mapping: MappingSyncRules | null = createMapping();
  if ("mapping" in options) {
    mapping = options.mapping ?? null;
  }

  return {
    appliedUpdates,
    dependencies: {
      canUseEventFilters: (userId) => {
        entitlementChecks.push(userId);
        return Promise.resolve(options.canUseEventFilters ?? true);
      },
      getMappingSyncRules: () => Promise.resolve(mapping),
      updateSyncRuleOverrides: (_userId, _sourceId, _destinationId, updates) => {
        appliedUpdates.push(updates);
        if (!mapping || options.disappearsBeforeWrite) {
          return Promise.resolve(null);
        }
        return Promise.resolve(createMapping({ ...mapping.overrides, ...updates }));
      },
    },
    entitlementChecks,
  };
};

const patch = (body: unknown, harness: PatchHarness, params: Record<string, string> = PARAMS) =>
  handlePatchMappingSyncRulesRoute(
    { body, params, userId: "user-1" },
    harness.dependencies,
  );

const readJson = (response: Response): Promise<unknown> => response.json();

describe("including upstream sources", () => {
  it("opts a link in without requiring a Pro plan", async () => {
    const harness = createPatchHarness({ canUseEventFilters: false });

    const response = await patch({ includeUpstreamSources: true }, harness);

    expect(response.status).toBe(200);
    expect(harness.appliedUpdates).toEqual([{ includeUpstreamSources: true }]);
    expect(harness.entitlementChecks).toEqual([]);
  });

  it("rejects a value that is not a boolean", async () => {
    const harness = createPatchHarness();

    const response = await patch({ includeUpstreamSources: null }, harness);

    expect(response.status).toBe(400);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("returns 402 when the inherited sources would exceed the plan", async () => {
    const harness = createPatchHarness();
    harness.dependencies.updateSyncRuleOverrides = () =>
      Promise.reject(new Error(MAPPING_LIMIT_ERROR_MESSAGE));

    const response = await patch({ includeUpstreamSources: true }, harness);

    expect(response.status).toBe(402);
    expect(await readJson(response)).toEqual({ error: MAPPING_LIMIT_ERROR_MESSAGE });
  });
});

describe("handleGetMappingSyncRulesRoute", () => {
  it("returns 404 without reading when an id is not a calendar id", async () => {
    let reads = 0;
    const response = await handleGetMappingSyncRulesRoute(
      { params: { destinationId: "not-a-uuid", id: SOURCE_ID }, userId: "user-1" },
      {
        getMappingSyncRules: () => {
          reads += 1;
          return Promise.resolve(createMapping());
        },
      },
    );

    expect(response.status).toBe(404);
    expect(reads).toBe(0);
  });

  it("returns 404 when the pair is not mapped for the user", async () => {
    const response = await handleGetMappingSyncRulesRoute(
      { params: PARAMS, userId: "user-1" },
      { getMappingSyncRules: () => Promise.resolve(null) },
    );

    expect(response.status).toBe(404);
  });

  it("returns overrides alongside the source and effective rules", async () => {
    const response = await handleGetMappingSyncRulesRoute(
      { params: PARAMS, userId: "user-1" },
      { getMappingSyncRules: () => Promise.resolve(createMapping({ excludeEventName: false })) },
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      destinationCalendarId: DESTINATION_ID,
      effectiveRules: { ...SOURCE_RULES, excludeEventName: false },
      includeUpstreamSources: false,
      overrides: { ...NO_SYNC_RULE_OVERRIDES, excludeEventName: false },
      sourceCalendarId: SOURCE_ID,
      sourceRules: SOURCE_RULES,
    });
  });

  it("keeps the source provider out of the response", async () => {
    const response = await handleGetMappingSyncRulesRoute(
      { params: PARAMS, userId: "user-1" },
      { getMappingSyncRules: () => Promise.resolve(createMapping()) },
    );

    expect(await readJson(response)).not.toHaveProperty("sourceProvider");
  });
});

describe("handlePatchMappingSyncRulesRoute", () => {
  it("returns 404 when an id is not a calendar id", async () => {
    const harness = createPatchHarness();
    const response = await patch({ excludeEventName: false }, harness, {
      destinationId: DESTINATION_ID,
      id: "source-1",
    });

    expect(response.status).toBe(404);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it.each([
    ["a non-object body", null],
    ["an unknown field", { excludeEventName: false, name: "Renamed" }],
    ["a source-only field", { syncFutureRange: "1_week" }],
    ["a wrongly typed boolean", { excludeEventName: "false" }],
    ["a wrongly typed template", { customEventName: 5 }],
    ["an unknown availability", { excludeAvailabilities: ["asleep"] }],
    ["an empty title keyword", { excludeTitleKeywords: [""] }],
  ])("returns 400 without writing for %s", async (_label, body) => {
    const harness = createPatchHarness();
    const response = await patch(body, harness);

    expect(response.status).toBe(400);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("returns 400 for an empty patch", async () => {
    const harness = createPatchHarness();
    const response = await patch({}, harness);

    expect(response.status).toBe(400);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("returns 404 when the pair is not mapped for the user", async () => {
    const harness = createPatchHarness({ mapping: null });
    const response = await patch({ excludeEventName: false }, harness);

    expect(response.status).toBe(404);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("returns 404 when the mapping is removed before the write lands", async () => {
    const harness = createPatchHarness({ disappearsBeforeWrite: true });
    const response = await patch({ excludeEventName: false }, harness);

    expect(response.status).toBe(404);
  });

  it("writes only the fields the patch names", async () => {
    const harness = createPatchHarness();
    const response = await patch({ excludeEventName: false }, harness);

    expect(response.status).toBe(200);
    expect(harness.appliedUpdates).toEqual([{ excludeEventName: false }]);
  });

  it("returns the updated overrides and effective rules", async () => {
    const harness = createPatchHarness();
    const response = await patch(
      { customEventName: "Busy ({{calendar_name}})", markEventsAsPrivate: true },
      harness,
    );

    expect(await readJson(response)).toEqual({
      destinationCalendarId: DESTINATION_ID,
      effectiveRules: {
        ...SOURCE_RULES,
        customEventName: "Busy ({{calendar_name}})",
        markEventsAsPrivate: true,
      },
      includeUpstreamSources: false,
      overrides: {
        ...NO_SYNC_RULE_OVERRIDES,
        customEventName: "Busy ({{calendar_name}})",
        markEventsAsPrivate: true,
      },
      sourceCalendarId: SOURCE_ID,
      sourceRules: SOURCE_RULES,
    });
  });

  it("stores false overrides rather than treating them as unset", async () => {
    const harness = createPatchHarness();
    await patch(
      {
        excludeAllDayEvents: false,
        excludeEventDescription: false,
        excludeEventLocation: false,
        excludeFocusTime: false,
        excludeOutOfOffice: false,
        markEventsAsPrivate: false,
      },
      harness,
    );

    expect(harness.appliedUpdates).toEqual([{
      excludeAllDayEvents: false,
      excludeEventDescription: false,
      excludeEventLocation: false,
      excludeFocusTime: false,
      excludeOutOfOffice: false,
      markEventsAsPrivate: false,
    }]);
  });

  it("clears an override when a field is null", async () => {
    const harness = createPatchHarness({
      mapping: createMapping({ excludeEventName: false, excludeTitleKeywords: ["lunch"] }),
    });
    const response = await patch({ excludeEventName: null, excludeTitleKeywords: null }, harness);

    expect(response.status).toBe(200);
    expect(harness.appliedUpdates).toEqual([
      { excludeEventName: null, excludeTitleKeywords: null },
    ]);
  });

  it("trims the event name template", async () => {
    const harness = createPatchHarness();
    await patch({ customEventName: "  Busy  " }, harness);

    expect(harness.appliedUpdates).toEqual([{ customEventName: "Busy" }]);
  });

  it("rejects a blank event name template instead of storing an empty override", async () => {
    const harness = createPatchHarness();
    const response = await patch({ customEventName: "   " }, harness);

    expect(response.status).toBe(400);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("normalizes title keywords", async () => {
    const harness = createPatchHarness();
    await patch({ excludeTitleKeywords: [" Lunch ", "lunch", "Gym"] }, harness);

    expect(harness.appliedUpdates).toEqual([{ excludeTitleKeywords: ["Lunch", "Gym"] }]);
  });

  it("stores an empty keyword list as an override that excludes nothing", async () => {
    const harness = createPatchHarness();
    await patch({ excludeTitleKeywords: [] }, harness);

    expect(harness.appliedUpdates).toEqual([{ excludeTitleKeywords: [] }]);
  });

  it("de-duplicates excluded availabilities", async () => {
    const harness = createPatchHarness();
    await patch({ excludeAvailabilities: ["free", "free", "busy"] }, harness);

    expect(harness.appliedUpdates).toEqual([{ excludeAvailabilities: ["free", "busy"] }]);
  });

  it("rejects an availability the source provider cannot report", async () => {
    const harness = createPatchHarness({ mapping: createMapping({}, "google") });
    const response = await patch({ excludeAvailabilities: ["tentative"] }, harness);

    expect(response.status).toBe(400);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("accepts an availability the source provider reports", async () => {
    const harness = createPatchHarness({ mapping: createMapping({}, "outlook") });
    const response = await patch({ excludeAvailabilities: ["tentative"] }, harness);

    expect(response.status).toBe(200);
    expect(harness.appliedUpdates).toEqual([{ excludeAvailabilities: ["tentative"] }]);
  });

  it("returns 403 when a free user sets an override", async () => {
    const harness = createPatchHarness({ canUseEventFilters: false });
    const response = await patch({ excludeEventName: false }, harness);

    expect(response.status).toBe(403);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("returns 403 when a free user mixes a reset with a new override", async () => {
    const harness = createPatchHarness({ canUseEventFilters: false });
    const response = await patch({ excludeEventName: null, markEventsAsPrivate: true }, harness);

    expect(response.status).toBe(403);
    expect(harness.appliedUpdates).toEqual([]);
  });

  it("lets a free user clear overrides without an entitlement check", async () => {
    const harness = createPatchHarness({
      canUseEventFilters: false,
      mapping: createMapping({ excludeEventName: false }),
    });
    const response = await patch({ excludeEventName: null }, harness);

    expect(response.status).toBe(200);
    expect(harness.entitlementChecks).toEqual([]);
    expect(harness.appliedUpdates).toEqual([{ excludeEventName: null }]);
  });
});
