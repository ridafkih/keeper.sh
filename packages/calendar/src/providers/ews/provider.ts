import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import type { CalendarSyncProvider } from "../../core/sync-engine/types";
import type {
  MaterializedSyncableEvent,
  RemoteEvent,
  PushResult,
  DeleteResult,
  SourceEvent,
} from "../../core/types";
import type { FetchEventsResult } from "../../core/sync-engine/ingest";
import type { SourceIngestionPlan } from "../../core/sync/sync-range";
import {
  generateDeterministicEventUid,
  isKeeperEvent,
} from "../../core/events/identity";
import {
  createEditableEventContentSnapshot,
  hashEditableEventContentSnapshot,
} from "../../core/events/content-hash";
import { EwsClient, EwsError, markerOf } from "./client";
import { child, descendants, textOf, escapeXml as x } from "./xml";
import type { XmlNode } from "./xml";
import type { EwsConfig, EwsRuntimeOptions } from "./config";
import { eventFields, eventXml, parseEwsEvent } from "./events";

interface EwsProviderConfig extends EwsRuntimeOptions {
  connection: EwsConfig;
  calendarId: string;
}
const failure = (error: unknown): PushResult => {
  const result: PushResult = {
    success: false,
    error: "EWS operation failed",
    errorType: "EwsError",
  };
  if (error instanceof EwsError) {
    result.errorType = error.code;
    result.statusCode = error.status;
  }
  return result;
};
const isMissing = (error: unknown): boolean =>
  error instanceof EwsError && error.code === "ErrorItemNotFound";
const assertOwned = (
  item: XmlNode,
  calendarId: string,
  uid?: string,
): string => {
  const marker = markerOf(item);
  if (
    !isKeeperEvent(marker) ||
    (uid && marker !== uid) ||
    child(item, "ParentFolderId")?.attributes.Id !== calendarId ||
    textOf(item, "IsMeeting") !== "false"
  ) {
    throw new EwsError("ForeignItem");
  }
  const id = child(item, "ItemId");
  if (!id?.attributes.Id || !id.attributes.ChangeKey) {
    throw new EwsError("MissingChangeKey");
  }
  return `<t:ItemId Id="${x(id.attributes.Id)}" ChangeKey="${x(id.attributes.ChangeKey)}"/>`;
};
const toRemote = (item: XmlNode): RemoteEvent => {
  const uid = markerOf(item);
  // Parse the content without discarding the mirror marker.
  const source = parseEwsEvent({
    ...item,
    children: item.children.filter(
      (field) => field.name !== "ExtendedProperty",
    ),
  });
  if (!source?.sourceEventId) {
    throw new EwsError("UnrepresentableMirror");
  }
  const editableContent = createEditableEventContentSnapshot({
    description: source.description,
    location: source.location,
    isAllDay: source.isAllDay,
    summary: source.title ?? "",
  });
  return {
    uid,
    deleteId: source.sourceEventId,
    startTime: source.startTime,
    endTime: source.endTime,
    isKeeperEvent: true,
    editableContent,
    editableContentHash: hashEditableEventContentSnapshot(editableContent),
    editableAvailability: source.availability,
    supportedAvailabilities: ["busy", "free", "oof"],
  };
};

const createEwsSourceFetcher = (
  config: EwsProviderConfig & { plan: SourceIngestionPlan },
) => ({
  fetchEvents: async (): Promise<FetchEventsResult> => {
    const client = new EwsClient(config.connection, config);
    const { window, futureRange, historicRange } = config.plan;
    const items = await client.listItems(
      config.calendarId,
      window.timeMin,
      window.timeMax,
    );
    const events: SourceEvent[] = [];
    let selfAuthoredEventCount = 0;
    for (const item of items) {
      if (isKeeperEvent(markerOf(item)) || isKeeperEvent(textOf(item, "UID")) || descendants(item, "Categories").some((category) => descendants(category, "String").some((node) => node.text === KEEPER_CATEGORY))) {
        selfAuthoredEventCount += 1;
        continue;
      }
      const parsed = parseEwsEvent(item);
      if (
        parsed &&
        parsed.startTime <= window.timeMax &&
        parsed.endTime >= window.timeMin
      ) {
        events.push(parsed);
      }
    }
    return {
      events,
      selfAuthoredEventCount,
      syncWindow: window,
      coverage: { window, futureRange, historicRange },
    };
  },
});

const createEwsSyncProvider = (
  config: EwsProviderConfig,
): CalendarSyncProvider => {
  const client = new EwsClient(config.connection, config);
  const update = async (
    item: XmlNode,
    event: MaterializedSyncableEvent,
    uid: string,
  ): Promise<PushResult> => {
    const target = assertOwned(item, config.calendarId, uid);
    const updates = eventFields(event)
      .map(
        ([uri, xml]) =>
          `<t:SetItemField><t:FieldURI FieldURI="${uri}"/><t:CalendarItem>${xml}</t:CalendarItem></t:SetItemField>`,
      )
      .join("");
    const result = await client.request(
      "UpdateItem",
      `<m:ItemChanges><t:ItemChange>${target}<t:Updates>${updates}</t:Updates></t:ItemChange></m:ItemChanges>`,
      'ConflictResolution="NeverOverwrite" MessageDisposition="SaveOnly" SendMeetingInvitationsOrCancellations="SendToNone"',
    );
    const id = descendants(result, "ItemId")[0]?.attributes.Id;
    if (!id) {
      throw new EwsError("MissingWriteReceipt");
    }
    return {
      success: true,
      remoteId: uid,
      deleteId: id,
      echo: { comparable: false, reason: "echo-body-missing" },
    };
  };
  return {
    normalizeEvent(event) {
      let availability = event.availability ?? "busy";
      if (availability === "workingElsewhere") {
        availability = "busy";
      }
      return { ...event, startTimeZone: "UTC", availability };
    },
    async pushEvents(events) {
      const results: PushResult[] = [];
      for (const event of events) {
        try {
          const uid = generateDeterministicEventUid(event.id);
          const existing = await client.findMirror(config.calendarId, uid);
          if (existing) {
            results.push({
              ...(await update(existing, event, uid)),
              conflictResolved: true,
            });
            continue;
          }
          const response = await client.request(
            "CreateItem",
            `<m:SavedItemFolderId>${EwsClient.folder(config.calendarId)}</m:SavedItemFolderId><m:Items>${eventXml(event, uid)}</m:Items>`,
            'SendMeetingInvitations="SendToNone"',
          );
          const id = descendants(response, "ItemId")[0]?.attributes.Id;
          if (!id) {
            throw new EwsError("MissingWriteReceipt");
          }
          results.push({
            success: true,
            remoteId: uid,
            deleteId: id,
            echo: { comparable: false, reason: "echo-body-missing" },
          });
        } catch (error) {
          if (config.safeFetchOptions?.signal?.aborted) {
            throw error;
          }
          results.push(failure(error));
        }
      }
      return results;
    },
    async updateEvents(updates) {
      const results: PushResult[] = [];
      for (const { event, deleteId } of updates) {
        try {
          results.push(
            await update(
              await client.getItem(deleteId),
              event,
              generateDeterministicEventUid(event.id),
            ),
          );
        } catch (error) {
          if (config.safeFetchOptions?.signal?.aborted) {
            throw error;
          }
          results.push(failure(error));
        }
      }
      return results;
    },
    async deleteEvents(ids) {
      const results: DeleteResult[] = [];
      for (const id of ids) {
        try {
          const target = assertOwned(
            await client.getItem(id),
            config.calendarId,
          );
          await client.request(
            "DeleteItem",
            `<m:ItemIds>${target}</m:ItemIds>`,
            'DeleteType="MoveToDeletedItems" SendMeetingCancellations="SendToNone" AffectedTaskOccurrences="AllOccurrences"',
          );
          results.push({ success: true });
        } catch (error) {
          if (config.safeFetchOptions?.signal?.aborted) {
            throw error;
          }
          if (isMissing(error)) {
            results.push({ success: true });
          } else {
            results.push(failure(error));
          }
        }
      }
      return results;
    },
    async listRemoteEvents({ timeMin, timeMax }) {
      const items = await client.listItems(config.calendarId, timeMin, timeMax);
      return items
        .filter((item) => isKeeperEvent(markerOf(item)))
        .map((item) => {
          assertOwned(item, config.calendarId);
          return toRemote(item);
        });
    },
    async getRemoteEventsByIds(ids) {
      const events: RemoteEvent[] = [];
      for (const id of ids) {
        try {
          const item = await client.getItem(id);
          assertOwned(item, config.calendarId);
          events.push(toRemote(item));
        } catch (error) {
          if (!isMissing(error)) {
            throw error;
          }
        }
      }
      return events;
    },
  };
};

export { createEwsSourceFetcher, createEwsSyncProvider };
export type { EwsProviderConfig };
