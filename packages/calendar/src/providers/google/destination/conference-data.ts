import type { GoogleEvent } from "@keeper.sh/data-schemas";
import { HTTP_STATUS } from "@keeper.sh/constants";
import type { GoogleApiError } from "../types";
import type { EventConference } from "../../../core/events/conference";
import { isRateLimitApiError } from "../shared/errors";

type GoogleConferenceDataResource = NonNullable<GoogleEvent["conferenceData"]>;

const HANGOUTS_MEET_SOLUTION_KEY = "hangoutsMeet";

/*
 * The mirror re-attaches the conference the source already owns: no createRequest
 * is ever sent, so Google is never asked to mint a second meeting for an event
 * that is only a copy. The payload carries the same entry points back, which is
 * what `conferenceDataVersion=1` lets an API client do.
 */
const buildGoogleConferenceData = (
  conference: EventConference,
): GoogleConferenceDataResource => ({
  conferenceSolution: { key: { type: HANGOUTS_MEET_SOLUTION_KEY } },
  entryPoints: conference.entryPoints.map((entryPoint) => ({
    entryPointType: entryPoint.type,
    uri: entryPoint.uri,
    ...(entryPoint.label && { label: entryPoint.label }),
    ...(entryPoint.pin && { pin: entryPoint.pin }),
  })),
  ...(conference.conferenceId && { conferenceId: conference.conferenceId }),
});

const CONFERENCE_ERROR_MARKERS = [
  "conference",
  "entrypoint",
];

const mentionsConference = (value: string | undefined): boolean => {
  if (!value) {
    return false;
  }
  const normalized = value.toLowerCase();
  return CONFERENCE_ERROR_MARKERS.some((marker) => normalized.includes(marker));
};

/*
 * Google rejects a conference it will not re-issue with a plain 400, and the
 * reason it gives varies. Rather than enumerate them, any rejection of a request
 * that carried conference data is worth one retry without it: losing the join
 * button is a smaller failure than losing the mirrored event, and a request that
 * never carried conference data never reaches this path.
 */
const isConferenceDataRejection = (
  statusCode: number,
  apiError: GoogleApiError,
): boolean => {
  if (isRateLimitApiError(statusCode, apiError)) {
    return false;
  }
  if (statusCode === HTTP_STATUS.BAD_REQUEST) {
    return true;
  }
  if (statusCode !== HTTP_STATUS.FORBIDDEN) {
    return false;
  }
  return mentionsConference(apiError.message)
    || (apiError.errors ?? []).some((entry) => mentionsConference(entry.reason));
};

const withoutConferenceData = (resource: GoogleEvent): GoogleEvent => {
  const { conferenceData: _conferenceData, ...rest } = resource;
  return rest;
};

export {
  buildGoogleConferenceData,
  isConferenceDataRejection,
  withoutConferenceData,
};
