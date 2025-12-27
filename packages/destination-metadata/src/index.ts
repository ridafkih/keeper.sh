export interface DestinationConfig {
  id: string;
  name: string;
  icon?: string;
  type: "oauth" | "caldav";
  comingSoon?: boolean;
}

export const DESTINATIONS: DestinationConfig[] = [
  {
    id: "google",
    name: "Google Calendar",
    icon: "/integrations/icon-google.svg",
    type: "oauth",
  },
  {
    id: "fastmail",
    name: "FastMail",
    icon: "/integrations/icon-fastmail.svg",
    type: "caldav",
  },
  {
    id: "icloud",
    name: "iCloud",
    icon: "/integrations/icon-icloud.svg",
    type: "caldav",
  },
  {
    id: "caldav",
    name: "CalDAV",
    type: "caldav",
  },
  {
    id: "outlook",
    name: "Outlook",
    icon: "/integrations/icon-outlook.svg",
    type: "oauth",
    comingSoon: true,
  },
];

export type DestinationId = (typeof DESTINATIONS)[number]["id"];

export const getDestination = (id: string): DestinationConfig | undefined =>
  DESTINATIONS.find((destination) => destination.id === id);

export const isCalDAVDestination = (id: string): boolean => {
  const destination = getDestination(id);
  return destination?.type === "caldav";
};

export const getActiveDestinations = (): DestinationConfig[] =>
  DESTINATIONS.filter((destination) => !destination.comingSoon);
