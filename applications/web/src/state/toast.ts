import { atom } from "jotai";

interface Toast {
  id: number;
  message: string;
}

const toastAtom = atom<Toast | null>(null);

const showToastAtom = atom(null, (get, set, message: string) => {
  const previous = get(toastAtom);
  set(toastAtom, { id: (previous?.id ?? 0) + 1, message });
});

const dismissToastAtom = atom(null, (get, set, id: number) => {
  if (get(toastAtom)?.id !== id) return;
  set(toastAtom, null);
});

export { dismissToastAtom, showToastAtom, toastAtom };
export type { Toast };
