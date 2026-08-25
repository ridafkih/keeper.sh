import type { EventVerificationTarget } from "../types";

/* The engine names a mirror by the id a delete would target plus the uid the mapping carries.
   Providers that need only the id accept either shape, so an older caller passing a bare id still
   asks the same question. */
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
