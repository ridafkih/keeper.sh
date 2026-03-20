import { createCalDAVSourceProvider } from "../../caldav/source/provider";
import type { CalDAVSourceProviderConfig } from "../../caldav/types";

const PROVIDER_OPTIONS = {
  providerId: "icloud",
  providerName: "iCloud",
};

const createICloudSourceProvider = (config: CalDAVSourceProviderConfig) =>
  createCalDAVSourceProvider(config, PROVIDER_OPTIONS);

export { createICloudSourceProvider };
