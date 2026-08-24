import { atom } from "jotai";
import { selectAtom } from "jotai/utils";

export const destinationIdsAtom = atom<Set<string>>(new Set<string>());

export const selectDestinationInclusion = (destinationId: string) =>
  selectAtom(destinationIdsAtom, (ids) => ids.has(destinationId));
