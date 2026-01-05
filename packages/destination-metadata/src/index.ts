interface DestinationConfig {
  id: string;
  name: string;
  icon?: string;
  type: "oauth" | "caldav";
  comingSoon?: boolean;
}

const DESTINATIONS_CONST = [
  {
    icon: "/integrations/icon-google.svg",
    id: "google",
    name: "Google Calendar",
    type: "oauth",
  },
  {
    icon: "/integrations/icon-outlook.svg",
    id: "outlook",
    name: "Outlook",
    type: "oauth",
  },
  {
    icon: "/integrations/icon-fastmail.svg",
    id: "fastmail",
    name: "FastMail",
    type: "caldav",
  },
  {
    icon: "/integrations/icon-icloud.svg",
    id: "icloud",
    name: "iCloud",
    type: "caldav",
  },
  {
    id: "caldav",
    name: "CalDAV",
    type: "caldav",
  },
] as const;

const DESTINATIONS: DestinationConfig[] = [...DESTINATIONS_CONST];

type DestinationId = (typeof DESTINATIONS_CONST)[number]["id"];

type CalDAVDestination = Extract<(typeof DESTINATIONS_CONST)[number], { type: "caldav" }>;

type CalDAVDestinationId = CalDAVDestination["id"];

const getDestination = (id: string): DestinationConfig | undefined =>
  DESTINATIONS.find((destination) => destination.id === id);

const isCalDAVDestination = (id: string): id is CalDAVDestinationId => {
  const destination = getDestination(id);
  return destination?.type === "caldav";
};

const getActiveDestinations = (): DestinationConfig[] =>
  DESTINATIONS.filter((destination) => !destination.comingSoon);

export { DESTINATIONS, getDestination, isCalDAVDestination, getActiveDestinations };
export type { DestinationConfig, DestinationId, CalDAVDestinationId };
