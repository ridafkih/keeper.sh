import { createCalDAVSourceProvider } from "../../caldav/source/provider";
import type { CalDAVSourceProviderConfig } from "../../caldav/types";

const PROVIDER_OPTIONS = {
  providerId: "fastmail",
  providerName: "Fastmail",
};

const createFastMailSourceProvider = (config: CalDAVSourceProviderConfig) =>
  createCalDAVSourceProvider(config, PROVIDER_OPTIONS);

export { createFastMailSourceProvider };
