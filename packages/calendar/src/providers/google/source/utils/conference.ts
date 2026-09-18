import type { EventConferenceEntryPoint } from "../../../../core/events/conference";
import { createEventConference } from "../../../../core/events/conference";
import type { EventConference } from "../../../../core/events/conference";
import type { GoogleCalendarEvent, GoogleConferenceEntryPoint } from "../types";

const HANGOUTS_MEET_SOLUTION = "hangoutsMeet";

/*
 * A Meet can reach us as structured `conferenceData`, as the legacy `hangoutLink`,
 * or as both. Anything else — a Zoom or Teams add-on conference — is left behind
 * on purpose: its entry points are grants the mirror has no standing to re-issue,
 * and Google would reject the copy anyway.
 */
const isHangoutsMeetConference = (event: GoogleCalendarEvent): boolean => {
  const solutionType = event.conferenceData?.conferenceSolution?.key?.type;
  if (solutionType) {
    return solutionType === HANGOUTS_MEET_SOLUTION;
  }

  return Boolean(event.hangoutLink) || (event.conferenceData?.entryPoints ?? []).length > 0;
};

const readEntryPointType = (
  value: string | undefined,
): EventConferenceEntryPoint["type"] | null => {
  if (value === "video" || value === "phone" || value === "more") {
    return value;
  }
  return null;
};

const toEntryPoint = (
  entryPoint: GoogleConferenceEntryPoint,
): EventConferenceEntryPoint[] => {
  const type = readEntryPointType(entryPoint.entryPointType);
  const uri = entryPoint.uri?.trim();
  if (!type || !uri) {
    return [];
  }

  return [{
    type,
    uri,
    ...(entryPoint.label?.trim() && { label: entryPoint.label.trim() }),
    ...(entryPoint.pin?.trim() && { pin: entryPoint.pin.trim() }),
  }];
};

/*
 * `hangoutLink` is appended rather than preferred: the structured entry point is
 * the one Google keeps current, and a duplicate of the same URL is dropped by the
 * model's own video-entry selection.
 */
const resolveGoogleEventConference = (
  event: GoogleCalendarEvent,
): EventConference | undefined => {
  if (!isHangoutsMeetConference(event)) {
    return;
  }

  const entryPoints = (event.conferenceData?.entryPoints ?? [])
    .flatMap((entryPoint) => toEntryPoint(entryPoint));

  const hangoutLink = event.hangoutLink?.trim();
  const hasVideoEntryPoint = entryPoints.some((entryPoint) => entryPoint.type === "video");
  if (hangoutLink && !hasVideoEntryPoint) {
    entryPoints.unshift({ type: "video", uri: hangoutLink });
  }

  return createEventConference(entryPoints, event.conferenceData?.conferenceId?.trim());
};

export { resolveGoogleEventConference };
