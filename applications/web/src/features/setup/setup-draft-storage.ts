import type { SetupDraft } from "./setup-draft";

export const SETUP_DRAFT_KEY = "keeper.setup_draft";

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ROLES = new Set(["source", "destination", "member"]);
const MODES = new Set(["one_way", "both_ways"]);
const SHARE_AS = new Set(["busy_only", "title_only", "full"]);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// Drafts only ever come from this tab's own session, so a structural check is enough to reject older versions.
const isSetupDraft = (value: unknown): value is SetupDraft => {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<SetupDraft>;
  const sync = draft.sync;
  return draft.version === 4
    && typeof draft.firstConnect === "boolean"
    && (draft.pending === null || (typeof draft.pending === "string" && ROLES.has(draft.pending)))
    && typeof sync === "object" && sync !== null
    && typeof sync.name === "string"
    && MODES.has(sync.mode)
    && SHARE_AS.has(sync.shareAs)
    && isStringArray(sync.sourceCalendarIds)
    && isStringArray(sync.destinationCalendarIds)
    && isStringArray(sync.memberCalendarIds)
    && isStringArray(sync.skipTitleKeywords)
    && Array.isArray(sync.rules);
};

export const resolveSessionStorage = (): DraftStorage | null => {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
};

export const readSetupDraft = (storage: DraftStorage | null): SetupDraft | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SETUP_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSetupDraft(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const writeSetupDraft = (storage: DraftStorage | null, draft: SetupDraft): void => {
  try {
    storage?.setItem(SETUP_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    return;
  }
};

export const clearSetupDraft = (storage: DraftStorage | null): void => {
  try {
    storage?.removeItem(SETUP_DRAFT_KEY);
  } catch {
    return;
  }
};

export const hasSessionFlag = (storage: DraftStorage | null, key: string): boolean => {
  try {
    return storage?.getItem(key) !== null && storage?.getItem(key) !== undefined;
  } catch {
    return false;
  }
};

export const setSessionFlag = (storage: DraftStorage | null, key: string): void => {
  try {
    storage?.setItem(key, "1");
  } catch {
    return;
  }
};
