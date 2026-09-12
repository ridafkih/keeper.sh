import { KEEPER_CATEGORY } from "@keeper.sh/constants";
import { resolveIsAllDayEvent } from "../../core/events/all-day";
import { Parser } from "htmlparser2";
import type { MaterializedSyncableEvent, SourceEvent } from "../../core/types";
import {
  instantToWallTime,
  resolveTimeZone,
} from "../../ics/utils/timezone-instant";
import { isKeeperEvent } from "../../core/events/identity";
import { child, textOf, escapeXml as x } from "./xml";
import type { XmlNode } from "./xml";
import { EwsError, markerOf, markerXml } from "./client";

const parseDate = (value: string): Date => {
  if (!/(Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new EwsError("AmbiguousEventTime");
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new EwsError("InvalidEventTime");
  }
  return date;
};
const bodyText = (item: XmlNode): string => {
  const body = child(item, "Body");
  let result = body?.text ?? "";
  if (body?.attributes.BodyType === "HTML") {
    result = "";
    let hidden = 0;
    const links: string[] = [];
    const parser = new Parser(
      {
        onopentag(name, attributes) {
          if (name === "script" || name === "style") {
            hidden += 1;
          }
          if (hidden) {
            return;
          }
          if (["br", "p", "div", "li"].includes(name)) {
            result += "\n";
          }
          if (name === "a" && /^https?:\/\//iu.test(attributes.href ?? "")) {
            links.push(attributes.href ?? "");
          }
        },
        ontext(text) {
          if (!hidden) {
            result += text;
          }
        },
        onclosetag(name) {
          if (name === "script" || name === "style") {
            hidden = Math.max(0, hidden - 1);
          }
          if (!hidden && ["p", "div", "li"].includes(name)) {
            result += "\n";
          }
        },
      },
      { decodeEntities: true },
    );
    parser.end(body.text);
    for (const link of new Set(links)) {
      if (!result.includes(link)) {
        result += `\n${link}`;
      }
    }
    result = result.trim();
  }
  const meetingLink = textOf(item, "OnlineMeetingJoinUrl");
  if (/^https?:\/\//iu.test(meetingLink) && !result.includes(meetingLink)) {
    result += `\n${meetingLink}`;
  }
  return result;
};

const parseAvailability = (item: XmlNode): SourceEvent["availability"] => {
  const busy = textOf(item, "LegacyFreeBusyStatus");
  let availability: SourceEvent["availability"] = "busy";
  if (busy === "Free") {
    availability = "free";
  }
  if (busy === "OOF") {
    availability = "oof";
  }
  if (busy === "WorkingElsewhere") {
    availability = "workingElsewhere";
  }
  return availability;
};

const parseEwsEvent = (item: XmlNode): SourceEvent | null => {
  if (textOf(item, "IsCancelled") === "true" || isKeeperEvent(markerOf(item))) {
    return null;
  }
  const uid = textOf(item, "UID");
  const sourceEventId = child(item, "ItemId")?.attributes.Id;
  if (!uid || !sourceEventId) {
    throw new EwsError("IncompleteCalendarItem");
  }
  if (isKeeperEvent(uid)) {
    return null;
  }
  let startTime = parseDate(textOf(item, "Start"));
  let endTime = parseDate(textOf(item, "End"));
  const isAllDay = textOf(item, "IsAllDayEvent") === "true";
  const zoneId = child(item, "StartTimeZone")?.attributes.Id ?? "UTC";
  if (isAllDay) {
    const zone = resolveTimeZone(zoneId);
    if (!zone) {
      throw new EwsError("UnsupportedAllDayTimeZone");
    }
    startTime = instantToWallTime(startTime, zone);
    endTime = instantToWallTime(endTime, zone);
    if (
      [startTime, endTime].some(
        (date) => date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0,
      )
    ) {
      throw new EwsError("InvalidAllDayRange");
    }
  }
  if (endTime < startTime) {
    throw new EwsError("InvalidEventRange");
  }
  const type = textOf(item, "CalendarItemType");
  if (type === "RecurringMaster") {
    throw new EwsError("UnexpandedRecurrence");
  }
  let eventUid = uid;
  if (type === "Occurrence" || type === "Exception") {
    const original =
      textOf(item, "RecurrenceId") ||
      textOf(item, "OriginalStart") ||
      textOf(item, "Start");
    eventUid = `${uid}/${parseDate(original).toISOString()}`;
  }
  return {
    uid: eventUid,
    sourceEventId,
    title: textOf(item, "Subject"),
    description: bodyText(item),
    location: textOf(item, "Location"),
    startTime,
    endTime,
    isAllDay,
    startTimeZone: zoneId,
    availability: parseAvailability(item),
  };
};

const eventFields = (event: MaterializedSyncableEvent): [string, string][] => {
  if (event.recurrenceRule || event.endTime < event.startTime) {
    throw new EwsError("InvalidMaterializedEvent");
  }
  let busy = "Busy";
  if (event.availability === "free") {
    busy = "Free";
  }
  if (event.availability === "oof") {
    busy = "OOF";
  }
  // WorkingElsewhere is unavailable on older EWS schemas; a busy mirror is conservative.
  let sensitivity = "Normal";
  if (event.isPrivate) {
    sensitivity = "Private";
  }
  return [
    ["item:Subject", `<t:Subject>${x(event.summary)}</t:Subject>`],
    ["item:Sensitivity", `<t:Sensitivity>${sensitivity}</t:Sensitivity>`],
    [
      "item:Body",
      `<t:Body BodyType="Text">${x(event.description ?? "")}</t:Body>`,
    ],
    ["item:Categories", `<t:Categories><t:String>${x(KEEPER_CATEGORY)}</t:String></t:Categories>`],
    ["item:ReminderIsSet", "<t:ReminderIsSet>false</t:ReminderIsSet>"],
    ["calendar:Start", `<t:Start>${event.startTime.toISOString()}</t:Start>`],
    ["calendar:End", `<t:End>${event.endTime.toISOString()}</t:End>`],
    [
      "calendar:IsAllDayEvent",
      `<t:IsAllDayEvent>${resolveIsAllDayEvent(event)}</t:IsAllDayEvent>`,
    ],
    [
      "calendar:LegacyFreeBusyStatus",
      `<t:LegacyFreeBusyStatus>${busy}</t:LegacyFreeBusyStatus>`,
    ],
    [
      "calendar:Location",
      `<t:Location>${x(event.location ?? "")}</t:Location>`,
    ],
    ["calendar:StartTimeZone", '<t:StartTimeZone Id="UTC"/>'],
    ["calendar:EndTimeZone", '<t:EndTimeZone Id="UTC"/>'],
  ];
};
const eventXml = (event: MaterializedSyncableEvent, uid: string): string => {
  const fields = eventFields(event);
  return `<t:CalendarItem>${fields
    .slice(0, 5)
    .map(([, xml]) => xml)
    .join("")}${markerXml(uid)}${fields
    .slice(5)
    .map(([, xml]) => xml)
    .join("")}</t:CalendarItem>`;
};

export { parseEwsEvent, eventFields, eventXml };
