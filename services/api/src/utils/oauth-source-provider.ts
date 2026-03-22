import {
  listGoogleUserCalendars as listGoogleCalendars,
  listOutlookUserCalendars as listOutlookCalendars,
} from "@keeper.sh/calendar";
import { UnsupportedOAuthProviderError } from "./oauth-source-errors";

const SUPPORTED_OAUTH_PROVIDER_IDS = new Set(["google", "outlook"]);
type OAuthProviderId = "google" | "outlook";

const isOAuthProviderId = (provider: string): provider is OAuthProviderId =>
  SUPPORTED_OAUTH_PROVIDER_IDS.has(provider);

function assertOAuthProviderId(
  operation: "source_create" | "account_import" | "calendar_listing",
  provider: string,
): asserts provider is OAuthProviderId {
  if (!isOAuthProviderId(provider)) {
    throw new UnsupportedOAuthProviderError(operation, provider);
  }
}

interface ExternalCalendarListing {
  externalId: string;
  name: string;
}

const listExternalOAuthCalendars = async (
  provider: string,
  accessToken: string,
): Promise<ExternalCalendarListing[]> => {
  assertOAuthProviderId("calendar_listing", provider);
  try {
    switch (provider) {
      case "google": {
        const calendars = await listGoogleCalendars(accessToken);
        return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.summary }));
      }
      case "outlook": {
        const calendars = await listOutlookCalendars(accessToken);
        return calendars.map((calendar) => ({ externalId: calendar.id, name: calendar.name }));
      }
    }
  } catch (error) {
    if (error instanceof Error && "authRequired" in error && error.authRequired === true) {
      return [];
    }
    throw error;
  }
};

export {
  assertOAuthProviderId,
  isOAuthProviderId,
  listExternalOAuthCalendars,
};
export type {
  ExternalCalendarListing,
  OAuthProviderId,
};
