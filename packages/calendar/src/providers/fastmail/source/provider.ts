import { createCalDAVSourceProvider } from "../../caldav";
import type { CalDAVSourceProviderConfig } from "../../caldav";

const PROVIDER_OPTIONS = {
  providerId: "fastmail",
  providerName: "Fastmail",
};

const createFastMailSourceProvider = (config: CalDAVSourceProviderConfig) =>
  createCalDAVSourceProvider(config, PROVIDER_OPTIONS);

export { createFastMailSourceProvider };
