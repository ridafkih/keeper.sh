import type { EventVerificationTarget } from "../types";

const toVerificationTarget = (
  target: EventVerificationTarget | string,
): EventVerificationTarget => {
  if (typeof target === "string") {
    return { deleteId: target };
  }
  return target;
};

const toVerificationDeleteIds = (
  targets: (EventVerificationTarget | string)[],
): string[] => targets.map((target) => toVerificationTarget(target).deleteId);

export { toVerificationDeleteIds, toVerificationTarget };
