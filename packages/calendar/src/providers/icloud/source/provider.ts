import { createCalDAVSourceProvider } from "../../caldav";
import type { CalDAVSourceProviderConfig } from "../../caldav";

const PROVIDER_OPTIONS = {
  providerId: "icloud",
  providerName: "iCloud",
};

const createICloudSourceProvider = (config: CalDAVSourceProviderConfig) =>
  createCalDAVSourceProvider(config, PROVIDER_OPTIONS);

export { createICloudSourceProvider };
