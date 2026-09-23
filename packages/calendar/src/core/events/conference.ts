const GOOGLE_MEET_HOST = "meet.google.com";
const GOOGLE_MEET_PHONE_HOST = "tel.meet";

type EventConferenceSolution = "hangoutsMeet";

/** `sip` is deliberately absent: it carries no join path a mirror can validate. */
type EventConferenceEntryPointType = "video" | "phone" | "more";

interface EventConferenceEntryPoint {
  type: EventConferenceEntryPointType;
  uri: string;
  label?: string;
  pin?: string;
}

interface EventConference {
  solution: EventConferenceSolution;
  conferenceId?: string;
  entryPoints: EventConferenceEntryPoint[];
}

const parseUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** A join URL is the one field a mirror hands a user, so the host is matched exactly. */
const isGoogleMeetVideoUri = (value: string): boolean => {
  const url = parseUrl(value);
  return url !== null
    && url.protocol === "https:"
    && url.hostname === GOOGLE_MEET_HOST
    && url.pathname.length > 1;
};

const isGoogleMeetPhoneUri = (value: string): boolean =>
  parseUrl(value)?.protocol === "tel:";

const isGoogleMeetMoreUri = (value: string): boolean => {
  const url = parseUrl(value);
  return url !== null
    && url.protocol === "https:"
    && (url.hostname === GOOGLE_MEET_PHONE_HOST || url.hostname === GOOGLE_MEET_HOST);
};

const ENTRY_POINT_VALIDATORS: Record<EventConferenceEntryPointType, (uri: string) => boolean> = {
  more: isGoogleMeetMoreUri,
  phone: isGoogleMeetPhoneUri,
  video: isGoogleMeetVideoUri,
};

const isEventConferenceEntryPointType = (
  value: unknown,
): value is EventConferenceEntryPointType =>
  value === "video" || value === "phone" || value === "more";

const isValidEntryPoint = (entryPoint: EventConferenceEntryPoint): boolean =>
  ENTRY_POINT_VALIDATORS[entryPoint.type](entryPoint.uri);

const getConferenceVideoUri = (conference: EventConference): string | undefined =>
  conference.entryPoints.find((entryPoint) => entryPoint.type === "video")?.uri;

/*
 * Every path into the model funnels through here, so a conference without a
 * usable video entry point cannot exist: a mirror showing a join button that
 * leads nowhere is worse than a mirror showing none.
 */
const createEventConference = (
  entryPoints: EventConferenceEntryPoint[],
  conferenceId?: string,
): EventConference | undefined => {
  const validEntryPoints = entryPoints.filter((entryPoint) => isValidEntryPoint(entryPoint));

  if (!validEntryPoints.some((entryPoint) => entryPoint.type === "video")) {
    return;
  }

  return {
    solution: "hangoutsMeet",
    ...(conferenceId && { conferenceId }),
    entryPoints: validEntryPoints,
  };
};

const readOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return;
  }
  return value;
};

const parseStoredEntryPoint = (value: unknown): EventConferenceEntryPoint | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const entry = value as Record<string, unknown>;
  const uri = readOptionalString(entry.uri);
  if (!uri || !isEventConferenceEntryPointType(entry.type)) {
    return null;
  }
  const label = readOptionalString(entry.label);
  const pin = readOptionalString(entry.pin);
  return { type: entry.type, uri, ...(label && { label }), ...(pin && { pin }) };
};

/** Key order is fixed so the serialized form doubles as a hash and diff input. */
const serializeEventConference = (
  conference: EventConference | undefined,
): string | null => {
  if (!conference) {
    return null;
  }

  return JSON.stringify({
    solution: conference.solution,
    conferenceId: conference.conferenceId ?? null,
    entryPoints: conference.entryPoints.map((entryPoint) => ({
      type: entryPoint.type,
      uri: entryPoint.uri,
      label: entryPoint.label ?? null,
      pin: entryPoint.pin ?? null,
    })),
  });
};

const readJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const parseStoredEventConference = (
  value: string | null | undefined,
): EventConference | undefined => {
  if (!value) {
    return;
  }

  const parsed = readJson(value);

  if (typeof parsed !== "object" || parsed === null) {
    return;
  }

  const stored = parsed as Record<string, unknown>;
  if (stored.solution !== "hangoutsMeet" || !Array.isArray(stored.entryPoints)) {
    return;
  }

  const entryPoints = stored.entryPoints.flatMap((entry) => {
    const entryPoint = parseStoredEntryPoint(entry);
    if (!entryPoint) {
      return [];
    }
    return [entryPoint];
  });

  return createEventConference(entryPoints, readOptionalString(stored.conferenceId));
};

/** Empty when absent so a conference-less event keeps the hash it already had. */
const conferenceIdentityValues = (
  conference: EventConference | undefined,
): string[] => {
  const serialized = serializeEventConference(conference);
  if (serialized === null) {
    return [];
  }
  return [`conference:${serialized}`];
};

export {
  conferenceIdentityValues,
  createEventConference,
  getConferenceVideoUri,
  isGoogleMeetVideoUri,
  parseStoredEventConference,
  serializeEventConference,
};
export type {
  EventConference,
  EventConferenceEntryPoint,
  EventConferenceEntryPointType,
};
