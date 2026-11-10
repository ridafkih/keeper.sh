import type { GoogleCalendarEvent } from "../types";

const isWebLink = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

// Build from the source description on each read: changed or removed conference
// Links replace the previous derived content without editing the Google event.
const resolveGoogleDescription = (event: GoogleCalendarEvent): string | undefined => {
  const candidates = [
    event.hangoutLink,
    ...event.conferenceData?.entryPoints
      ?.filter((entry) => entry.entryPointType === "video")
      .map((entry) => entry.uri) ?? [],
  ];
  const link = candidates
    .map((candidate) => candidate?.trim())
    .find((candidate): candidate is string => Boolean(candidate && isWebLink(candidate)));

  if (!link || event.description?.includes(link)) {
    return event.description;
  }

  let label = "Join video meeting";
  if (new URL(link).hostname === "meet.google.com") {
    label = "Join Google Meet";
  }
  const conferenceLine = `${label}: ${link}`;
  if (event.description) {
    return `${event.description}\n\n${conferenceLine}`;
  }
  return conferenceLine;
};

export { resolveGoogleDescription };
