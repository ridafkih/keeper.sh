import type { DestinationProvider } from "@keeper.sh/integrations";
import { GoogleCalendarProvider } from "@keeper.sh/integration-google-calendar";
import { CalDAVProvider } from "@keeper.sh/integration-caldav";
import { FastMailProvider } from "@keeper.sh/integration-fastmail";
import { ICloudProvider } from "@keeper.sh/integration-icloud";

export const destinationProviders: DestinationProvider[] = [
  GoogleCalendarProvider,
  CalDAVProvider,
  FastMailProvider,
  ICloudProvider,
];

export {
  GoogleCalendarProvider,
  CalDAVProvider,
  FastMailProvider,
  ICloudProvider,
};

export {
  DESTINATIONS,
  getDestination,
  isCalDAVDestination,
  getActiveDestinations,
  type DestinationConfig,
  type DestinationId,
} from "@keeper.sh/destination-metadata";
