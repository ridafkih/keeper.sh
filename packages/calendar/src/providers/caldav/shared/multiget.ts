import type { createDAVClient } from "tsdav";

type DAVClientInstance = Awaited<ReturnType<typeof createDAVClient>>;
type DAVResponseRow = Awaited<ReturnType<DAVClientInstance["davRequest"]>>[number];

interface MultiGetObject {
  url: string;
  etag?: string;
  data?: unknown;
}

interface MultiGetBatch {
  calendarUrl: string;
  objectUrls: string[];
  urlFilter: (url: string) => boolean;
}

const DAV_NAMESPACE = "DAV:";
const CALDAV_NAMESPACE = "urn:ietf:params:xml:ns:caldav";
const NOT_FOUND_STATUS = 404;
const FIRST_ERROR_STATUS = 400;
const MULTIGET_NOT_FOUND_PREFIX = `Collection query failed: ${String(NOT_FOUND_STATUS)}`;

const isMultiGetNotFoundError = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith(MULTIGET_NOT_FOUND_PREFIX);

const toRequestedHrefs = (batch: MultiGetBatch): string[] =>
  batch.objectUrls
    .map((objectUrl) => new URL(objectUrl, batch.calendarUrl).href)
    .filter((objectUrl) => batch.urlFilter(objectUrl))
    .map((objectUrl) => new URL(objectUrl).pathname);

const isObjectRow = (row: DAVResponseRow): boolean => Boolean(row.props);

const isMissingObjectRow = (row: DAVResponseRow): boolean => row.status === NOT_FOUND_STATUS;

const isFailedObjectRow = (row: DAVResponseRow): boolean =>
  row.ok === false || (row.status ?? 0) >= FIRST_ERROR_STATUS;

const readCalendarData = (calendarData: unknown): unknown => {
  if (typeof calendarData === "object" && calendarData !== null && "_cdata" in calendarData) {
    return calendarData._cdata;
  }
  return calendarData;
};

const readEtag = (etag: unknown): Pick<MultiGetObject, "etag"> => {
  if (typeof etag === "string") {
    return { etag };
  }
  return {};
};

const toMultiGetObject = (row: DAVResponseRow, calendarUrl: string): MultiGetObject => ({
  data: readCalendarData(row.props?.calendarData),
  ...readEtag(row.props?.getetag),
  url: new URL(row.href ?? "", calendarUrl).href,
});

const requestObjectStatuses = (client: DAVClientInstance, batch: MultiGetBatch): Promise<DAVResponseRow[]> =>
  client.davRequest({
    init: {
      body: {
        "calendar-multiget": {
          _attributes: { "xmlns:c": CALDAV_NAMESPACE, "xmlns:d": DAV_NAMESPACE },
          "d:href": toRequestedHrefs(batch),
          "d:prop": { "c:calendar-data": {}, "d:getetag": {} },
        },
      },
      headers: { depth: "1" },
      method: "REPORT",
      namespace: "c",
    },
    url: batch.calendarUrl,
  });

const toObjectFailure = (row: DAVResponseRow): Error =>
  new Error(`Collection query failed: ${String(row.status)} ${row.statusText ?? ""}`.trim());

const refetchWithoutMissingObjects = async (
  client: DAVClientInstance,
  batch: MultiGetBatch,
  collectionError: unknown,
): Promise<MultiGetObject[]> => {
  const rows = await requestObjectStatuses(client, batch);
  if (rows.some((row) => !isObjectRow(row))) {
    throw collectionError;
  }
  const presentRows = rows.filter((row) => !isMissingObjectRow(row));
  const failedRow = presentRows.find((row) => isFailedObjectRow(row));
  if (failedRow) {
    throw toObjectFailure(failedRow);
  }
  return presentRows.map((row) => toMultiGetObject(row, batch.calendarUrl));
};

const fetchMultiGetBatch = async (
  client: DAVClientInstance,
  batch: MultiGetBatch,
): Promise<MultiGetObject[]> => {
  try {
    return await client.fetchCalendarObjects({
      calendar: { url: batch.calendarUrl },
      objectUrls: batch.objectUrls,
      urlFilter: batch.urlFilter,
    });
  } catch (error) {
    if (!isMultiGetNotFoundError(error)) {
      throw error;
    }
    return refetchWithoutMissingObjects(client, batch, error);
  }
};

export { fetchMultiGetBatch };
export type { MultiGetBatch, MultiGetObject };
