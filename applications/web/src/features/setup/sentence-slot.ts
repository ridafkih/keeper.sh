import { sameBlank, type SetupBlank } from "./setup-draft";

export type SentenceSlot = SetupBlank | { kind: "detail" };

export const sameSlot = (left: SentenceSlot, right: SentenceSlot): boolean => {
  if (left.kind === "detail" || right.kind === "detail") return left.kind === right.kind;
  return sameBlank(left, right);
};
