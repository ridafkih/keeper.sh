import { useState } from "react";
import { useAtomValue } from "jotai";
import { syncStateAtom } from "@/state/sync";
import { advanceCopyProgress } from "./copy-progress";
import type { CopyProgress } from "./copy-progress";

export function useCopyProgress(): CopyProgress | null {
  const sync = useAtomValue(syncStateAtom);
  const [progress, setProgress] = useState<CopyProgress | null>(null);
  const next = advanceCopyProgress(progress, sync);
  if (next !== progress) setProgress(next);
  return next;
}
