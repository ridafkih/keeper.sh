import {
  createCalDAVProvider,
  type CalDAVProviderConfig,
} from "@keeper.sh/integration-caldav";
import type { DestinationProvider } from "@keeper.sh/integration";

export const ICLOUD_SERVER_URL = "https://caldav.icloud.com/";

const PROVIDER_OPTIONS = {
  providerId: "icloud",
  providerName: "iCloud",
};

export const createICloudProvider = (
  config: CalDAVProviderConfig,
): DestinationProvider => {
  return createCalDAVProvider(config, PROVIDER_OPTIONS);
};
