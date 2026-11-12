import type { LinkProps } from "@tanstack/react-router";

export type ConnectProviderGroup = "feed" | "account" | "server";

export interface ConnectProvider {
  id: string;
  label: string;
  to: LinkProps["to"];
  group: ConnectProviderGroup;
  analyticsProvider: string;
  iconSrc?: string;
  pullOnly?: boolean;
}

export const CONNECT_PROVIDERS: readonly ConnectProvider[] = [
  { analyticsProvider: "ical", group: "feed", id: "ical-link", label: "Subscribe to ICS Calendar Feed", pullOnly: true, to: "/dashboard/connect/ical-link" },
  { analyticsProvider: "google", group: "account", iconSrc: "/integrations/icon-google.svg", id: "google", label: "Connect Google Calendar", to: "/dashboard/connect/google" },
  { analyticsProvider: "outlook", group: "account", iconSrc: "/integrations/icon-outlook.svg", id: "outlook", label: "Connect Outlook", to: "/dashboard/connect/outlook" },
  { analyticsProvider: "apple", group: "account", iconSrc: "/integrations/icon-icloud.svg", id: "apple", label: "Connect iCloud", to: "/dashboard/connect/apple" },
  { analyticsProvider: "microsoft", group: "account", iconSrc: "/integrations/icon-microsoft-365.svg", id: "microsoft", label: "Connect Microsoft 365", to: "/dashboard/connect/microsoft" },
  { analyticsProvider: "fastmail", group: "account", iconSrc: "/integrations/icon-fastmail.svg", id: "fastmail", label: "Connect Fastmail", to: "/dashboard/connect/fastmail" },
  { analyticsProvider: "caldav", group: "server", id: "caldav", label: "Connect CalDAV Server", to: "/dashboard/connect/caldav" },
];

export const CONNECT_PROVIDER_GROUPS: readonly ConnectProviderGroup[] = ["feed", "account", "server"];
