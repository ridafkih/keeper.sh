import type { ElementCompact } from "xml-js";
import { DAVNamespace, DAVNamespaceShort } from "tsdav";

const davAttributes = {
  [`xmlns:${DAVNamespaceShort.DAV}`]: DAVNamespace.DAV,
  [`xmlns:${DAVNamespaceShort.CALDAV}`]: DAVNamespace.CALDAV,
  [`xmlns:${DAVNamespaceShort.CALENDAR_SERVER}`]: DAVNamespace.CALENDAR_SERVER,
} as const;

const syncCollectionProps = (): ElementCompact => ({
  [DAVNamespaceShort.DAV]: { getetag: {} },
  [DAVNamespaceShort.CALDAV]: { "calendar-data": {} },
});

const enumerationProps = (): ElementCompact => ({
  [DAVNamespaceShort.DAV]: { getetag: {}, resourcetype: {} },
});

const collectionStateProps = (): ElementCompact => ({
  [DAVNamespaceShort.CALENDAR_SERVER]: { getctag: {} },
  [DAVNamespaceShort.DAV]: { "sync-token": {} },
});

const etagProps = (): ElementCompact => ({
  [DAVNamespaceShort.DAV]: { getetag: {} },
});

const supportedReportProps = (): ElementCompact => ({
  [DAVNamespaceShort.DAV]: { "supported-report-set": {} },
});

const namesIn = (branch: unknown): Readonly<Record<string, unknown>> => {
  if (typeof branch !== "object" || branch === null) {
    return {};
  }
  return Object.fromEntries(Object.keys(branch).map((name) => [name, {}]));
};

const flattenProps = (declared: ElementCompact): ElementCompact =>
  Object.fromEntries(
    Object.entries(declared).flatMap(([namespace, names]) =>
      Object.keys(namesIn(names)).map((name) => [`${namespace}:${name}`, {}]),
    ),
  );

const syncCollectionRequestBody = (token: string | null): ElementCompact => ({
  "sync-collection": {
    _attributes: davAttributes,
    "d:sync-level": { _text: "1" },
    "d:sync-token": { _text: token ?? "" },
    "d:prop": flattenProps(syncCollectionProps()),
  },
});

const multigetRequestBody = (paths: readonly string[]): ElementCompact => ({
  "calendar-multiget": {
    _attributes: davAttributes,
    "d:prop": flattenProps(syncCollectionProps()),
    "d:href": paths.map((path) => ({ _text: path })),
  },
});

export {
  collectionStateProps,
  enumerationProps,
  etagProps,
  flattenProps,
  multigetRequestBody,
  supportedReportProps,
  syncCollectionProps,
  syncCollectionRequestBody,
};
