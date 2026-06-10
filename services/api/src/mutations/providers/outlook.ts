import { HTTP_STATUS } from "@keeper.sh/constants";
import { microsoftApiErrorSchema, outlookCalendarViewListSchema, outlookEventListSchema, outlookEventSchema } from "@keeper.sh/data-schemas";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { EventInput, EventUpdateInput, EventActionResult, RsvpStatus } from "@/types";

const MICROSOFT_GRAPH_API = "https://graph.microsoft.com/v1.0";

const buildHeaders = (accessToken: string): Record<string, string> => ({
  "Authorization": `Bearer ${accessToken}`,
  "Content-Type": "application/json",
});

const handleErrorResponse = async (response: Response): Promise<string> => {
  const body = await response.json();
  const { error } = microsoftApiErrorSchema.assert(body);
  return error?.message ?? response.statusText;
};

interface OutlookEventResult {
  sourceEventUid: string;
}

const formatDateTime = (isoString: string, isAllDay: boolean): string => {
  if (isAllDay) {
    return isoString.replace("Z", "");
  }
  return isoString;
};

const resolveOutlookShowAs = (availability?: string | null): string => {
  if (availability === "free") {
    return "free";
  }

  return "busy";
};

const createOutlookEvent = async (
  accessToken: string,
  input: EventInput,
): Promise<EventActionResult & Partial<OutlookEventResult>> => {
  const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendar/events`);
  const isAllDay = input.isAllDay ?? false;

  const resource: Record<string, unknown> = {
    subject: input.title,
    start: {
      dateTime: formatDateTime(input.startTime, isAllDay),
      timeZone: "UTC",
    },
    end: {
      dateTime: formatDateTime(input.endTime, isAllDay),
      timeZone: "UTC",
    },
    isAllDay,
    showAs: resolveOutlookShowAs(input.availability),
  };

  if (input.description) {
    resource.body = { content: input.description, contentType: "text" };
  }

  if (input.location) {
    resource.location = { displayName: input.location };
  }

  const response = await fetch(url, {
    body: JSON.stringify(resource),
    headers: buildHeaders(accessToken),
    method: "POST",
  });

  if (!response.ok) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  const created = outlookEventSchema.assert(await response.json());
  return { success: true, sourceEventUid: created.iCalUId ?? created.id };
};

const findOutlookEventByUid = async (
  accessToken: string,
  sourceEventUid: string,
): Promise<OutlookEvent | null> => {
  const url = new URL(`${MICROSOFT_GRAPH_API}/me/events`);
  url.searchParams.set("$filter", `iCalUId eq '${sourceEventUid}'`);
  url.searchParams.set("$top", "1");

  const response = await fetch(url, {
    headers: buildHeaders(accessToken),
    method: "GET",
  });

  if (!response.ok) {
    return null;
  }

  const body = outlookEventListSchema.assert(await response.json());
  const [item] = body.value ?? [];
  return item ?? null;
};

const updateOutlookEvent = async (
  accessToken: string,
  sourceEventUid: string,
  updates: EventUpdateInput,
): Promise<EventActionResult> => {
  const existing = await findOutlookEventByUid(accessToken, sourceEventUid);

  if (!existing?.id) {
    return { success: false, error: "Event not found on Outlook." };
  }

  const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${existing.id}`);

  const patch: Record<string, unknown> = {};
  if ("title" in updates) {
    patch.subject = updates.title;
  }
  if ("description" in updates) {
    patch.body = { content: updates.description, contentType: "text" };
  }
  if ("location" in updates) {
    patch.location = { displayName: updates.location };
  }

  const isAllDay = updates.isAllDay ?? existing.isAllDay ?? false;
  if ("startTime" in updates && updates.startTime) {
    patch.start = {
      dateTime: formatDateTime(updates.startTime, isAllDay),
      timeZone: "UTC",
    };
  }
  if ("endTime" in updates && updates.endTime) {
    patch.end = {
      dateTime: formatDateTime(updates.endTime, isAllDay),
      timeZone: "UTC",
    };
  }
  if ("isAllDay" in updates) {
    patch.isAllDay = updates.isAllDay;
  }
  if ("availability" in updates) {
    patch.showAs = resolveOutlookShowAs(updates.availability);
  }

  const response = await fetch(url, {
    body: JSON.stringify(patch),
    headers: buildHeaders(accessToken),
    method: "PATCH",
  });

  if (!response.ok) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  await response.json();
  return { success: true };
};

const deleteOutlookEvent = async (
  accessToken: string,
  sourceEventUid: string,
): Promise<EventActionResult> => {
  const existing = await findOutlookEventByUid(accessToken, sourceEventUid);

  if (!existing?.id) {
    return { success: true };
  }

  const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${existing.id}`);

  const response = await fetch(url, {
    headers: buildHeaders(accessToken),
    method: "DELETE",
  });

  if (!response.ok && response.status !== HTTP_STATUS.NOT_FOUND) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  await response.body?.cancel?.();
  return { success: true };
};

const RSVP_ACTION_MAP: Record<RsvpStatus, string> = {
  accepted: "accept",
  declined: "decline",
  tentative: "tentativelyAccept",
};

const rsvpOutlookEvent = async (
  accessToken: string,
  sourceEventUid: string,
  status: RsvpStatus,
): Promise<EventActionResult> => {
  const existing = await findOutlookEventByUid(accessToken, sourceEventUid);

  if (!existing?.id) {
    return { success: false, error: "Event not found on Outlook." };
  }

  const action = RSVP_ACTION_MAP[status];
  const url = new URL(`${MICROSOFT_GRAPH_API}/me/events/${existing.id}/${action}`);

  const response = await fetch(url, {
    body: JSON.stringify({ sendResponse: true }),
    headers: buildHeaders(accessToken),
    method: "POST",
  });

  if (!response.ok) {
    const errorMessage = await handleErrorResponse(response);
    return { success: false, error: errorMessage };
  }

  await response.body?.cancel?.();
  return { success: true };
};

const buildCalendarViewUrl = (from: string, to: string, nextLink: string | null): URL => {
  if (nextLink) {
    return new URL(nextLink);
  }

  const url = new URL(`${MICROSOFT_GRAPH_API}/me/calendarview`);
  url.searchParams.set("startdatetime", from);
  url.searchParams.set("enddatetime", to);
  url.searchParams.set("$top", "100");
  url.searchParams.set("$select", "id,iCalUId,subject,bodyPreview,location,start,end,isAllDay,responseStatus,organizer");
  url.searchParams.set("$filter", "responseStatus/response eq 'notResponded'");
  return url;
};

const getPendingOutlookInvites = async (
  accessToken: string,
  from: string,
  to: string,
): Promise<{
  sourceEventUid: string;
  title: string | null;
  description: string | null;
  location: string | null;
  startTime: string;
  endTime: string;
  isAllDay: boolean;
  organizer: string | null;
}[]> => {
  const pendingEvents: {
    sourceEventUid: string;
    title: string | null;
    description: string | null;
    location: string | null;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    organizer: string | null;
  }[] = [];

  let nextLink: string | null = null;

  do {
    const url = buildCalendarViewUrl(from, to, nextLink);

    const response = await fetch(url, {
      headers: buildHeaders(accessToken),
      method: "GET",
    });

    if (!response.ok) {
      break;
    }

    const body = outlookCalendarViewListSchema.assert(await response.json());

    for (const event of body.value ?? []) {
      if (!event.iCalUId) {
        continue;
      }

      if (!event.start?.dateTime || !event.end?.dateTime) {
        continue;
      }

      pendingEvents.push({
        sourceEventUid: event.iCalUId,
        title: event.subject ?? null,
        description: event.bodyPreview ?? null,
        location: event.location?.displayName ?? null,
        startTime: event.start.dateTime,
        endTime: event.end.dateTime,
        isAllDay: event.isAllDay ?? false,
        organizer: event.organizer?.emailAddress?.address ?? null,
      });
    }

    nextLink = body["@odata.nextLink"] ?? null;
  } while (nextLink);

  return pendingEvents;
};

export { createOutlookEvent, updateOutlookEvent, deleteOutlookEvent, rsvpOutlookEvent, getPendingOutlookInvites };
