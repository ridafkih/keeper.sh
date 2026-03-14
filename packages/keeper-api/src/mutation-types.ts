import type { KeeperEvent } from "./types";

interface EventInput {
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  startTime: string;
  endTime: string;
  isAllDay?: boolean;
  availability?: "busy" | "free";
}

interface EventUpdateInput {
  title?: string;
  description?: string;
  location?: string;
  startTime?: string;
  endTime?: string;
  isAllDay?: boolean;
  availability?: "busy" | "free";
}

type RsvpStatus = "accepted" | "declined" | "tentative";

interface EventActionResult {
  success: boolean;
  error?: string;
}

interface EventCreateResult extends EventActionResult {
  event?: KeeperEvent;
}

interface ProviderCredentials {
  provider: string;
  calendarId: string;
  externalCalendarId: string | null;
  calendarUrl: string | null;
  email: string | null;
  oauth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  };
  caldav?: {
    serverUrl: string;
    username: string;
    encryptedPassword: string;
  };
}

export type {
  EventInput,
  EventUpdateInput,
  EventActionResult,
  EventCreateResult,
  ProviderCredentials,
  RsvpStatus,
};
