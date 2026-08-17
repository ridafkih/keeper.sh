import { atom } from "jotai";
import { selectAtom } from "jotai/utils";

export const destinationIdsAtom = atom<Set<string>>(new Set<string>());

export const selectDestinationInclusion = (destinationId: string) =>
  selectAtom(destinationIdsAtom, (ids) => ids.has(destinationId));

export type WriteBackMode = "edits" | "edits_and_deletes" | "off";

export const writeBackModesAtom = atom<Record<string, WriteBackMode>>({});

export const selectWriteBackMode = (destinationId: string) =>
  selectAtom(
    writeBackModesAtom,
    (modes): WriteBackMode => modes[destinationId] ?? "off",
  );

export interface WriteBackStatus {
  /*
   * Whether a read has come back with at least one copy since the copies went missing,
   * decided by the server. Absent on a payload written before the gate existed, and read
   * as locked: withholding the deletion costs an extra pass, offering it on evidence that
   * was never established costs real events.
   */
  deletesUnlocked?: boolean;
  reason: string | null;
  /*
   * How far a write may reach. Absent on a payload written before the levels existed, and
   * read as the narrowest: a permission missing from a response must never render as one
   * that was given.
   */
  writeBackReach?: string;
  state: string;
}

export const writeBackStatesAtom = atom<Record<string, WriteBackStatus>>({});

export const selectWriteBackState = (destinationId: string) =>
  selectAtom(
    writeBackStatesAtom,
    (states): WriteBackStatus | null => states[destinationId] ?? null,
  );

export const selectSiblingDestinationCount = (destinationId: string) =>
  selectAtom(
    destinationIdsAtom,
    (ids) => [...ids].filter((id) => id !== destinationId).length,
  );
