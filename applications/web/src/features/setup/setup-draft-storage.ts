import { type } from "arktype";
import type { SetupDraft } from "./setup-draft";

export const SETUP_DRAFT_KEY = "keeper.setup_draft";

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const ruleSchema = type({
  fromId: "string | null",
  id: "string",
  syncRuleId: "string | null",
  toIds: "string[]",
});

const blankSchema = type({ kind: "'from'" }).or({ index: "number.integer >= 0", kind: "'to'" });

const pendingSchema = type({
  blank: blankSchema,
  ruleId: "string",
});

const draftSchema = type({
  pending: pendingSchema.or("null"),
  rules: ruleSchema.array(),
  version: "3",
});

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
    const parsed = draftSchema(JSON.parse(raw));
    return parsed instanceof type.errors ? null : parsed;
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
