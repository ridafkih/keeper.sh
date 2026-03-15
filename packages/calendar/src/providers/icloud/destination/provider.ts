import { createCalDAVProvider } from "../../caldav";
import type { CalDAVProviderConfig } from "../../caldav";
import type { DestinationProvider } from "../../../core/sync/destinations";

const ICLOUD_SERVER_URL = "https://caldav.icloud.com/";

const PROVIDER_OPTIONS = {
  providerId: "icloud",
  providerName: "iCloud",
};

const createICloudProvider = (config: CalDAVProviderConfig): DestinationProvider =>
  createCalDAVProvider(config, PROVIDER_OPTIONS);

export { ICLOUD_SERVER_URL, createICloudProvider };
