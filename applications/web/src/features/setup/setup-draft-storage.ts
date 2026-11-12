import type { SetupDraft } from "./setup-draft";

export const SETUP_DRAFT_KEY = "keeper.setup_draft";
export const LOGIN_IMPORT_KEY = "keeper.login_import_done";

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
  return draft.version === 5
    && typeof draft.firstConnect === "boolean"
    && (draft.connectedAccountId === null || typeof draft.connectedAccountId === "string")
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

// A tab can outlive a sign-out, so a draft only comes back for the user who wrote it.
export const readSetupDraft = (storage: DraftStorage | null, userId: string): SetupDraft | null => {
  if (!storage) return null;
  try {
    const raw = storage.getItem(SETUP_DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || !("userId" in parsed) || !("draft" in parsed)) return null;
    if (parsed.userId !== userId) return null;
    return isSetupDraft(parsed.draft) ? parsed.draft : null;
  } catch {
    return null;
  }
};

export const writeSetupDraft = (storage: DraftStorage | null, userId: string, draft: SetupDraft): void => {
  try {
    storage?.setItem(SETUP_DRAFT_KEY, JSON.stringify({ draft, userId }));
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

export const hasImportedLogin = (storage: DraftStorage | null, userId: string): boolean => {
  try {
    return storage?.getItem(LOGIN_IMPORT_KEY) === userId;
  } catch {
    return false;
  }
};

export const markLoginImported = (storage: DraftStorage | null, userId: string): void => {
  try {
    storage?.setItem(LOGIN_IMPORT_KEY, userId);
  } catch {
    return;
  }
};

export const clearSetupSession = (storage: DraftStorage | null): void => {
  try {
    storage?.removeItem(SETUP_DRAFT_KEY);
    storage?.removeItem(LOGIN_IMPORT_KEY);
  } catch {
    return;
  }
};
