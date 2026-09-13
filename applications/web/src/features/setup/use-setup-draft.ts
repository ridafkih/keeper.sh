import { useCallback, useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { setupDraftAtom } from "@/state/setup-draft";
import { createEmptyDraft, type SetupDraft } from "./setup-draft";
import {
  clearSetupDraft,
  readSetupDraft,
  resolveSessionStorage,
  writeSetupDraft,
} from "./setup-draft-storage";

export type DraftUpdater = (draft: SetupDraft) => SetupDraft;

export function useSetupDraft() {
  const store = useStore();
  const draft = useAtomValue(setupDraftAtom);

  useEffect(() => {
    if (store.get(setupDraftAtom)) return;
    store.set(setupDraftAtom, readSetupDraft(resolveSessionStorage()) ?? createEmptyDraft());
  }, [store]);

  const update = useCallback((updater: DraftUpdater) => {
    const current = store.get(setupDraftAtom);
    if (!current) return;
    const next = updater(current);
    if (next === current) return;
    store.set(setupDraftAtom, next);
    writeSetupDraft(resolveSessionStorage(), next);
  }, [store]);

  const clear = useCallback(() => {
    clearSetupDraft(resolveSessionStorage());
    store.set(setupDraftAtom, createEmptyDraft());
  }, [store]);

  return { clear, draft, update };
}
