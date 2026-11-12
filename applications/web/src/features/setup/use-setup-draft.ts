import { useCallback, useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { useSession } from "@/hooks/use-session";
import { setupDraftAtom } from "@/state/setup-draft";
import { createEmptyDraft, type SetupDraft } from "./setup-draft";
import {
  clearSetupDraft,
  readSetupDraft,
  resolveSessionStorage,
  writeSetupDraft,
} from "./setup-draft-storage";

export type DraftUpdater = (draft: SetupDraft) => SetupDraft;

// Stays null until the signed-in user is known, since the stored draft belongs to one user.
export function useSetupDraft() {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const store = useStore();
  const draft = useAtomValue(setupDraftAtom);

  useEffect(() => {
    if (!userId || store.get(setupDraftAtom)) return;
    store.set(setupDraftAtom, readSetupDraft(resolveSessionStorage(), userId) ?? createEmptyDraft());
  }, [store, userId]);

  const update = useCallback((updater: DraftUpdater) => {
    const current = store.get(setupDraftAtom);
    if (!current || !userId) return;
    const next = updater(current);
    if (next === current) return;
    store.set(setupDraftAtom, next);
    writeSetupDraft(resolveSessionStorage(), userId, next);
  }, [store, userId]);

  const clear = useCallback(() => {
    clearSetupDraft(resolveSessionStorage());
    store.set(setupDraftAtom, createEmptyDraft());
  }, [store]);

  return { clear, draft, update };
}
