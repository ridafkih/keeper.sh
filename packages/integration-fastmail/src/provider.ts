import { createCalDAVProvider } from "@keeper.sh/integration-caldav";
import type { CalDAVProviderConfig } from "@keeper.sh/integration-caldav";
import type { DestinationProvider } from "@keeper.sh/integration";

const FASTMAIL_SERVER_URL = "https://caldav.fastmail.com/";

const PROVIDER_OPTIONS = {
  providerId: "fastmail",
  providerName: "FastMail",
};

const createFastMailProvider = (config: CalDAVProviderConfig): DestinationProvider =>
  createCalDAVProvider(config, PROVIDER_OPTIONS);

export { FASTMAIL_SERVER_URL, createFastMailProvider };
