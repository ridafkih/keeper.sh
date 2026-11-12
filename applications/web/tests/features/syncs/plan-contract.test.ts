import { describe, expect, it } from "vitest";
import { addsProSettings, validateSyncCalendarLimit } from "@keeper.sh/data-schemas";
import { buildFirstConnectDraft, createSyncDraft, toCreateBody, type SyncDraft } from "../../../src/features/syncs/sync-draft";
import { syncSettingsOf } from "../../../src/features/syncs/syncs";
import { SYNC_TEMPLATES, SYNC_TEMPLATE_ORDER, isSyncTemplateKey } from "../../../src/features/syncs/templates";
import { makeSource } from "../setup/fixtures";

const FREE_CALENDAR_LIMIT = 3;
const accounts = ["google", "outlook", "icloud", "fastmail"].map((account) => makeSource(account, account));

// What the API checks, on the body the client sends, before it creates a sync for a free plan.
const freePlanRefusal = (draft: SyncDraft): string | null => {
  const sent = { ...draft, ...toCreateBody(draft, "Fallback"), rules: draft.rules };
  if (addsProSettings(null, syncSettingsOf(sent))) return "This setting requires a Pro plan.";
  return validateSyncCalendarLimit(sent, null, FREE_CALENDAR_LIMIT);
};

describe("free-plan drafts", () => {
  it.each(SYNC_TEMPLATE_ORDER)("builds %s without anything a free plan can't create", (key) => {
    const draft = createSyncDraft(key, {}, { locked: true });
    expect(addsProSettings(null, syncSettingsOf(draft))).toBe(false);
    expect(freePlanRefusal(draft)).toBeNull();
  });

  it("builds the first-connect draft without Pro settings or more calendars than the plan allows", () => {
    const draft = buildFirstConnectDraft(accounts.slice(0, FREE_CALENDAR_LIMIT), false);
    if (!draft) throw new Error("expected a first-connect draft");
    expect(addsProSettings(null, syncSettingsOf(draft))).toBe(false);
    expect(validateSyncCalendarLimit(draft, null, FREE_CALENDAR_LIMIT)).toBeNull();
    expect(freePlanRefusal(draft)).toBeNull();
  });

  it("marks exactly the profiles whose settings need Pro", () => {
    for (const key of SYNC_TEMPLATE_ORDER) {
      expect(SYNC_TEMPLATES[key].requiresPro).toBe(addsProSettings(null, syncSettingsOf(createSyncDraft(key))));
    }
  });

  it("only takes the profile keys themselves from a URL", () => {
    expect(SYNC_TEMPLATE_ORDER.every(isSyncTemplateKey)).toBe(true);
    expect(["__proto__", "constructor", "toString", "valueOf", 1, null].some(isSyncTemplateKey)).toBe(false);
  });
});
