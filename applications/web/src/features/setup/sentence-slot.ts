import { sameBlank, type SetupBlank } from "./setup-draft";

export type SentenceSlot = SetupBlank | { kind: "rule" };

export const sameSlot = (left: SentenceSlot, right: SentenceSlot): boolean => {
  if (left.kind === "rule" || right.kind === "rule") return left.kind === right.kind;
  return sameBlank(left, right);
};
