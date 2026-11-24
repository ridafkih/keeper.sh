import type { GoogleCalendarEvent } from "../types";

const VIDEO_ENTRY_POINT_TYPE = "video";
const WEB_PROTOCOLS = new Set(["https:", "http:"]);

const readVideoEntryPointUri = (event: GoogleCalendarEvent): string | undefined =>
  event.conferenceData?.entryPoints
    ?.find((entryPoint) => entryPoint.entryPointType === VIDEO_ENTRY_POINT_TYPE)
    ?.uri;

const resolveGoogleMeetingLink = (event: GoogleCalendarEvent): string | undefined => {
  const uri = readVideoEntryPointUri(event);
  if (uri === globalThis.undefined) {
    return uri;
  }

  const { protocol } = new URL(uri);
  if (!WEB_PROTOCOLS.has(protocol)) {
    throw new Error(`Google event ${String(event.id)} has a video entry point that is not a web link`);
  }

  return uri;
};

export { resolveGoogleMeetingLink };
