import { describe, expect, test } from "vitest";
import { defaultShadowLimits, renderCatalog } from "../../src/index";
import { cataloged, firstOf, runShadow } from "../support/scenario";
import { planWith, retireTombstone } from "../support/plans";
import {
  destinationSnapshot,
  mirrorRow,
  ownMirrorEvent,
  shadowOptions,
  slotIdentity,
  storedSourceEvent,
  syncInput,
} from "../support/fixtures";

const identity = slotIdentity("evt-one", "2026-03-10T09:00:00.000Z", "2026-03-10T10:00:00.000Z");

const stubPlan = () => planWith({ tombstones: [retireTombstone(identity, "absentFromSnapshot")] });

describe("the handle the plan would actually use", () => {
  test("SHADOW-I17: a handle taken from the observed listing is labelled as such", () => {
    const catalog = cataloged(
      runShadow(
        syncInput({
          storedSourceEvents: [storedSourceEvent({ identity })],
          mirrors: [
            mirrorRow({
              identity,
              destinationId: "mirror-evt-one",
              destinationHandle: "handle-stale",
            }),
          ],
          destinationListing: destinationSnapshot({
            events: [
              ownMirrorEvent({
                id: "mirror-evt-one",
                uid: "evt-one",
                deleteHandle: "handle-evt-one",
              }),
            ],
          }),
        }),
        shadowOptions({ plan: stubPlan }),
      ),
    );
    const entry = firstOf(catalog.deletions);

    expect(entry.deleteHandle.value).toBe("handle-evt-one");
    expect(entry.handleSource).toBe("observedListing");
    expect(renderCatalog(catalog, defaultShadowLimits)["shadow.deletions.handle_fallback_count"]).toBe(0);
  });

  test("SHADOW-I17: a mapping with no observed mirror falls back and says so", () => {
    const catalog = cataloged(
      runShadow(
        syncInput({
          storedSourceEvents: [storedSourceEvent({ identity })],
          mirrors: [
            mirrorRow({
              identity,
              destinationId: "mirror-evt-one",
              destinationHandle: "handle-evt-one",
            }),
          ],
          destinationListing: destinationSnapshot({ events: [] }),
        }),
        shadowOptions({ plan: stubPlan }),
      ),
    );
    const entry = firstOf(catalog.deletions);

    expect(entry.handleSource).toBe("storedMapping");
    expect(entry.deleteHandle.value).toBe("handle-evt-one");
    expect(renderCatalog(catalog, defaultShadowLimits)["shadow.deletions.handle_fallback_count"]).toBe(1);
  });
});
