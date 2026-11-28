import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { NO_SYNC_RULE_OVERRIDES, resolveSyncRules } from "@keeper.sh/data-schemas";
import type { MappingSyncRules } from "../../src/types/api";
import type { Rules } from "../../src/utils/mapping-sync-rules";
import { HttpError } from "../../src/lib/fetcher";
import { useMappingSyncRules } from "../../src/hooks/use-mapping-sync-rules";
import { mountHook } from "../helpers/mount-hook";

const KEY = "/api/sources/source-1/destinations/destination-1";
const LIST_KEY = "/api/sources/source-1/destinations";

const SOURCE_RULES: Rules = {
  customEventName: "{{calendar_name}}",
  disableEventReminders: false,
  excludeAllDayEvents: false,
  excludeAvailabilities: [],
  excludeEventDescription: true,
  excludeEventLocation: true,
  excludeEventMeetingLink: false,
  excludeEventName: true,
  excludeFocusTime: false,
  excludeOutOfOffice: false,
  excludeTitleKeywords: [],
  markEventsAsPrivate: false,
};

const INITIAL: MappingSyncRules = {
  destinationCalendarId: "destination-1",
  effectiveRules: resolveSyncRules(SOURCE_RULES, NO_SYNC_RULE_OVERRIDES),
  includeUpstreamSources: false,
  overrides: { ...NO_SYNC_RULE_OVERRIDES },
  sourceCalendarId: "source-1",
  sourceRules: SOURCE_RULES,
};

type CacheUpdater = (current: MappingSyncRules | undefined) => MappingSyncRules | undefined;

const { cache, apiFetch, revalidations, globalRevalidations } = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  cache: { current: undefined as unknown },
  globalRevalidations: [] as string[],
  revalidations: { count: 0 },
}));

vi.mock("swr", () => ({
  default: () => ({
    data: cache.current,
    error: undefined,
    isLoading: false,
    mutate: (updater?: CacheUpdater) => {
      if (!updater) {
        revalidations.count += 1;
        return Promise.resolve(undefined);
      }
      cache.current = updater(cache.current as MappingSyncRules | undefined);
      return Promise.resolve(cache.current);
    },
  }),
  useSWRConfig: () => ({
    mutate: (key: string) => {
      globalRevalidations.push(key);
      return Promise.resolve(undefined);
    },
  }),
}));

vi.mock("../../src/lib/fetcher", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/lib/fetcher")>()),
  apiFetch,
}));

const flush = async (): Promise<void> => {
  await React.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const readCache = (): MappingSyncRules => cache.current as MappingSyncRules;

const sentBodies = (): unknown[] =>
  apiFetch.mock.calls.map(([, options]) => JSON.parse((options as RequestInit).body as string));

describe("useMappingSyncRules", () => {
  let hook: ReturnType<typeof mountHook<ReturnType<typeof useMappingSyncRules>>>;

  beforeEach(() => {
    cache.current = structuredClone(INITIAL);
    revalidations.count = 0;
    globalRevalidations.length = 0;
    apiFetch.mockReset();
    apiFetch.mockResolvedValue(new Response("{}"));
    hook = mountHook(() => useMappingSyncRules("source-1", "destination-1"));
  });

  afterEach(async () => {
    await flush();
    hook.unmount();
  });

  it("applies a patch to the cached rules before the server answers", async () => {
    React.act(() => {
      hook.latest().patchOverrides({ excludeEventName: false });
    });

    expect(readCache().overrides.excludeEventName).toBe(false);
    expect(readCache().effectiveRules.excludeEventName).toBe(false);
    await flush();
  });

  it("includes inherited events in the cached mapping before the server answers", async () => {
    React.act(() => {
      hook.latest().setIncludeUpstreamSources(true);
    });

    expect(readCache().includeUpstreamSources).toBe(true);
    await flush();
  });

  it("sends the inherited events choice and refreshes the destination's sources", async () => {
    React.act(() => {
      hook.latest().setIncludeUpstreamSources(true);
    });
    await flush();

    expect(sentBodies()).toEqual([{ includeUpstreamSources: true }]);
    expect(globalRevalidations).toContain("/api/sources/destination-1/sources");
  });

  it("sends the patch to the mapping's own endpoint", async () => {
    React.act(() => {
      hook.latest().patchOverrides({ markEventsAsPrivate: true });
    });
    await flush();

    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(apiFetch.mock.calls[0]?.[0]).toBe(KEY);
    expect((apiFetch.mock.calls[0]?.[1] as RequestInit).method).toBe("PATCH");
    expect(sentBodies()).toEqual([{ markEventsAsPrivate: true }]);
  });

  it("refreshes the destination list so the customized marker stays current", async () => {
    React.act(() => {
      hook.latest().patchOverrides({ markEventsAsPrivate: true });
    });
    await flush();

    expect(globalRevalidations).toEqual([LIST_KEY]);
  });

  it("merges patches made while a save is in flight into one follow-up request", async () => {
    const firstSave = Promise.withResolvers<Response>();
    apiFetch.mockReturnValueOnce(firstSave.promise);

    React.act(() => {
      hook.latest().patchOverrides({ excludeEventName: false });
      hook.latest().patchOverrides({ excludeEventLocation: false });
      hook.latest().patchOverrides({ excludeEventName: null });
    });
    firstSave.resolve(new Response("{}"));
    await flush();

    expect(sentBodies()).toEqual([
      { excludeEventName: false },
      { excludeEventLocation: false, excludeEventName: null },
    ]);
    expect(readCache().overrides).toEqual({
      ...NO_SYNC_RULE_OVERRIDES,
      excludeEventLocation: false,
    });
  });

  it("reports a rejected save and reloads the rules the server holds", async () => {
    apiFetch.mockRejectedValueOnce(
      new HttpError(403, KEY, { error: "This setting requires a Pro plan." }),
    );

    React.act(() => {
      hook.latest().patchOverrides({ excludeEventName: false });
    });
    await flush();

    expect(hook.latest().saveError).toBe("This setting requires a Pro plan.");
    expect(revalidations.count).toBe(1);
    expect(globalRevalidations).toEqual([]);
  });

  it("clears a previous save error on the next change", async () => {
    apiFetch.mockRejectedValueOnce(new HttpError(500, KEY));
    React.act(() => {
      hook.latest().patchOverrides({ excludeEventName: false });
    });
    await flush();
    expect(hook.latest().saveError).not.toBeNull();

    React.act(() => {
      hook.latest().patchOverrides({ excludeEventName: false });
    });
    await flush();

    expect(hook.latest().saveError).toBeNull();
  });
});
