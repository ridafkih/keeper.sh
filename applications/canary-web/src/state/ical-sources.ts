import { atom } from "jotai";
import { selectAtom } from "jotai/utils";

export const icalSourceInclusionAtom = atom<Record<string, boolean>>({});

export const selectSourceInclusion = (sourceId: string) =>
  selectAtom(icalSourceInclusionAtom, (inclusion) => inclusion[sourceId] ?? false);
