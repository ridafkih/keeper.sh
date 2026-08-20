import type { WriteIntent } from "@keeper.sh/sync-protocol";
import { assertNever } from "@keeper.sh/sync-protocol";
import { sourceIdentityKey } from "../identity/source-identity";
import type { PlannedWrite } from "./plan";

const compareText = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  if (left < right) {
    return -1;
  }
  return 1;
};

const compareNumbers = (left: number, right: number): number => {
  if (left === right) {
    return 0;
  }
  if (left < right) {
    return -1;
  }
  return 1;
};

const rankOfIntent = (intent: WriteIntent): number => {
  switch (intent.kind) {
    case "delete":
    case "retire": {
      return 0;
    }
    case "update": {
      return 2;
    }
    case "create": {
      return 3;
    }
    default: {
      return assertNever(intent);
    }
  }
};

const rankOfWrite = (write: PlannedWrite): number => {
  switch (write.kind) {
    case "single": {
      return rankOfIntent(write.intent);
    }
    case "replace": {
      return 1;
    }
    default: {
      return assertNever(write);
    }
  }
};

const comparePlannedWrites = (left: PlannedWrite, right: PlannedWrite): number => {
  const byInstant = compareText(left.at.value, right.at.value);
  if (byInstant !== 0) {
    return byInstant;
  }
  const byRank = compareNumbers(rankOfWrite(left), rankOfWrite(right));
  if (byRank !== 0) {
    return byRank;
  }
  return compareText(sourceIdentityKey(left.identity), sourceIdentityKey(right.identity));
};

export { compareNumbers, comparePlannedWrites, compareText };
