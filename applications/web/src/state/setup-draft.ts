import { atom } from "jotai";
import type { SetupDraft } from "@/features/setup/setup-draft";

// Null until hydrated from session storage on the client.
export const setupDraftAtom = atom<SetupDraft | null>(null);
setupDraftAtom.onMount = (set) => () => set(null);
