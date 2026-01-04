import {
  createCalDAVProvider,
  type CalDAVProviderConfig,
} from "@keeper.sh/integration-caldav";
import type { DestinationProvider } from "@keeper.sh/integration";

export const FASTMAIL_SERVER_URL = "https://caldav.fastmail.com/";

const PROVIDER_OPTIONS = {
  providerId: "fastmail",
  providerName: "FastMail",
};

export const createFastMailProvider = (
  config: CalDAVProviderConfig,
): DestinationProvider => {
  return createCalDAVProvider(config, PROVIDER_OPTIONS);
};
