import type { EventUid, IdempotencyKey } from "@keeper.sh/sync-protocol";

const resourceSuffix = ".ics";
const unsafeSegment = /[^A-Za-z0-9._@:+-]/u;
const dotSegment = /(?:^|\.)\.$|^\.+$/u;

const namesOneResource = (key: IdempotencyKey): boolean => {
  if (key.value.length === 0) {
    return false;
  }
  if (unsafeSegment.test(key.value)) {
    return false;
  }
  return !dotSegment.test(key.value);
};

const createdResourcePath = (collectionPath: string, key: IdempotencyKey): string =>
  `${collectionPath}${key.value}${resourceSuffix}`;

const createdResourceUid = (key: IdempotencyKey): EventUid => ({
  kind: "eventUid",
  value: key.value,
});

const namesItsOwnUid = (path: string, uid: EventUid): boolean =>
  path.endsWith(`/${uid.value}${resourceSuffix}`);

export { createdResourcePath, createdResourceUid, namesItsOwnUid, namesOneResource };
