import { createCalDAVProvider } from "../../caldav";
import type { CalDAVProviderConfig } from "../../caldav";
import type{ DestinationProvider } from "../../../core/sync/destinations";

const FASTMAIL_SERVER_URL = "https://caldav.fastmail.com/";

const PROVIDER_OPTIONS = {
  providerId: "fastmail",
  providerName: "Fastmail",
};

const createFastMailProvider = (config: CalDAVProviderConfig): DestinationProvider =>
  createCalDAVProvider(config, PROVIDER_OPTIONS);

export { FASTMAIL_SERVER_URL, createFastMailProvider };
