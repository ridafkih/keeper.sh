import { createCalDAVSourceProvider } from "@keeper.sh/provider-caldav";
import type { CalDAVSourceProviderConfig } from "@keeper.sh/provider-caldav";

const PROVIDER_OPTIONS = {
  providerId: "icloud",
  providerName: "iCloud",
};

const createICloudSourceProvider = (config: CalDAVSourceProviderConfig) =>
  createCalDAVSourceProvider(config, PROVIDER_OPTIONS);

export { createICloudSourceProvider };
