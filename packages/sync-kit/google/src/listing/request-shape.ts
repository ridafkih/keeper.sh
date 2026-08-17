import type { calendar_v3 } from "@googleapis/calendar";
import type { ListingScope } from "@keeper.sh/sync-protocol";
import { googleListingLimits } from "../limits";

type ListingParameters = calendar_v3.Params$Resource$Events$List;

const sharedListingParameters = {
  singleEvents: false,
  showDeleted: true,
  maxResults: googleListingLimits.maxResults,
} as const;

const pagedFrom = (pageToken: string | null): ListingParameters => {
  if (pageToken === null) {
    return {};
  }
  return { pageToken };
};

const snapshotParameters = (scope: ListingScope, pageToken: string | null): ListingParameters => {
  const { window: bounds } = scope;
  return {
    ...sharedListingParameters,
    calendarId: scope.calendar.calendar.value,
    timeMin: bounds.start.value,
    timeMax: bounds.end.value,
    ...pagedFrom(pageToken),
  };
};

const deltaParameters = (
  scope: ListingScope,
  syncToken: string,
  pageToken: string | null,
): ListingParameters => ({
  ...sharedListingParameters,
  calendarId: scope.calendar.calendar.value,
  syncToken,
  ...pagedFrom(pageToken),
});

export { deltaParameters, sharedListingParameters, snapshotParameters };
export type { ListingParameters };
