import { calendarDestinationsTable } from "@keeper.sh/database/schema";
import { createCalDAVClient } from "@keeper.sh/integration-caldav";
import { encryptPassword } from "@keeper.sh/encryption";
import { eq } from "drizzle-orm";
import { saveCalDAVDestination } from "./destinations";
import { triggerDestinationSync } from "./sync";
import { database, encryptionKey, premiumService } from "../context";

class DestinationLimitError extends Error {
  constructor() {
    super("Destination limit reached. Upgrade to Pro.");
  }
}

class CalDAVConnectionError extends Error {
  constructor(cause?: unknown) {
    super("Failed to connect. Check credentials and server URL.");
    this.cause = cause;
  }
}

interface CalDAVCredentials {
  username: string;
  password: string;
}

interface DiscoveredCalendar {
  url: string;
  displayName: string | undefined;
}

const VALID_PROVIDERS = ["caldav", "fastmail", "icloud"] as const;
type CalDAVProvider = (typeof VALID_PROVIDERS)[number];

/**
 * Validates that a provider name is valid.
 */
const isValidProvider = (provider: string): provider is CalDAVProvider =>
  VALID_PROVIDERS.some((validProvider) => validProvider === provider);

/**
 * Discovers calendars available at a CalDAV server.
 * Throws CalDAVConnectionError if connection fails.
 */
const discoverCalendars = async (
  serverUrl: string,
  credentials: CalDAVCredentials,
): Promise<DiscoveredCalendar[]> => {
  try {
    const client = createCalDAVClient({
      credentials,
      serverUrl,
    });

    const calendars = await client.discoverCalendars();

    return calendars.map((calendar) => ({
      displayName: calendar.displayName,
      url: calendar.url,
    }));
  } catch (error) {
    throw new CalDAVConnectionError(error);
  }
};

/**
 * Validates CalDAV credentials by attempting to discover calendars.
 * Throws an error if credentials are invalid.
 */
const validateCredentials = async (
  serverUrl: string,
  credentials: CalDAVCredentials,
): Promise<void> => {
  const client = createCalDAVClient({
    credentials,
    serverUrl,
  });

  await client.discoverCalendars();
};

/**
 * Creates a CalDAV destination for a user.
 * Validates credentials, checks limits, encrypts password, and triggers sync.
 * Throws if limit reached or credentials invalid.
 */
const createCalDAVDestination = async (
  userId: string,
  provider: CalDAVProvider,
  serverUrl: string,
  credentials: CalDAVCredentials,
  calendarUrl: string,
): Promise<void> => {
  const existingDestinations = await database
    .select({ id: calendarDestinationsTable.id })
    .from(calendarDestinationsTable)
    .where(eq(calendarDestinationsTable.userId, userId));

  const allowed = await premiumService.canAddDestination(userId, existingDestinations.length);
  if (!allowed) {
    throw new DestinationLimitError();
  }

  try {
    await validateCredentials(serverUrl, credentials);
  } catch (error) {
    throw new CalDAVConnectionError(error);
  }

  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY must be set to use CalDAV destinations");
  }

  const encrypted = encryptPassword(credentials.password, encryptionKey);
  const serverHost = new URL(serverUrl).host;
  const accountId = `${credentials.username}@${serverHost}`;

  await saveCalDAVDestination(
    userId,
    provider,
    accountId,
    credentials.username,
    serverUrl,
    calendarUrl,
    credentials.username,
    encrypted,
  );

  triggerDestinationSync(userId);
};

export {
  DestinationLimitError,
  CalDAVConnectionError,
  isValidProvider,
  discoverCalendars,
  createCalDAVDestination,
};
