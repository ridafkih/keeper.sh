import { HTTP_STATUS } from "@keeper.sh/constants";
import { microsoftApiErrorSchema } from "@keeper.sh/data-schemas";
import type { OutlookEvent } from "@keeper.sh/data-schemas";
import type { EventInput, EventUpdateInput, EventActionResult, RsvpStatus } from "../../mutation-types";

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
    showAs: input.availability === "free" ? "free" : "busy",
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

  const created = await response.json() as OutlookEvent;
  return { success: true, sourceEventUid: created.iCalUId ?? created.id ?? undefined };
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

  const body = await response.json() as { value?: OutlookEvent[] };
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
  if (updates.title !== undefined) {
    patch.subject = updates.title;
  }
  if (updates.description !== undefined) {
    patch.body = { content: updates.description, contentType: "text" };
  }
  if (updates.location !== undefined) {
    patch.location = { displayName: updates.location };
  }

  const isAllDay = updates.isAllDay ?? existing.isAllDay ?? false;
  if (updates.startTime !== undefined) {
    patch.start = {
      dateTime: formatDateTime(updates.startTime, isAllDay),
      timeZone: "UTC",
    };
  }
  if (updates.endTime !== undefined) {
    patch.end = {
      dateTime: formatDateTime(updates.endTime, isAllDay),
      timeZone: "UTC",
    };
  }
  if (updates.isAllDay !== undefined) {
    patch.isAllDay = updates.isAllDay;
  }
  if (updates.availability !== undefined) {
    patch.showAs = updates.availability === "free" ? "free" : "busy";
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

export { createOutlookEvent, updateOutlookEvent, deleteOutlookEvent, rsvpOutlookEvent };
