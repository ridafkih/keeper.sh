import { resolveSyncTokenFromMachine } from "./sync-token-strategy-runtime";

const VERSIONED_SYNC_TOKEN_PREFIX = "keeper:sync-token:";
const LEGACY_SYNC_WINDOW_VERSION = 0;

interface DecodedSyncToken {
  syncToken: string;
  syncWindowVersion: number;
}

interface ResolvedSyncToken {
  syncToken: string | null;
  requiresBackfill: boolean;
}

const parseVersionNumber = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < LEGACY_SYNC_WINDOW_VERSION) {
    return LEGACY_SYNC_WINDOW_VERSION;
  }
  return parsed;
};

const decodeStoredSyncToken = (storedSyncToken: string): DecodedSyncToken => {
  if (!storedSyncToken.startsWith(VERSIONED_SYNC_TOKEN_PREFIX)) {
    return {
      syncToken: storedSyncToken,
      syncWindowVersion: LEGACY_SYNC_WINDOW_VERSION,
    };
  }

  const serializedValue = storedSyncToken.slice(VERSIONED_SYNC_TOKEN_PREFIX.length);
  const separatorIndex = serializedValue.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === serializedValue.length - 1) {
    return {
      syncToken: storedSyncToken,
      syncWindowVersion: LEGACY_SYNC_WINDOW_VERSION,
    };
  }

  const versionValue = serializedValue.slice(0, separatorIndex);
  const encodedTokenValue = serializedValue.slice(separatorIndex + 1);

  try {
    const decodedToken = Buffer.from(encodedTokenValue, "base64url").toString("utf8");
    if (decodedToken.length === 0) {
      return {
        syncToken: storedSyncToken,
        syncWindowVersion: LEGACY_SYNC_WINDOW_VERSION,
      };
    }

    return {
      syncToken: decodedToken,
      syncWindowVersion: parseVersionNumber(versionValue),
    };
  } catch {
    return {
      syncToken: storedSyncToken,
      syncWindowVersion: LEGACY_SYNC_WINDOW_VERSION,
    };
  }
};

const encodeStoredSyncToken = (
  syncToken: string,
  syncWindowVersion: number,
): string => {
  const encodedTokenValue = Buffer.from(syncToken, "utf8").toString("base64url");
  const normalizedVersion = parseVersionNumber(String(syncWindowVersion));
  return `${VERSIONED_SYNC_TOKEN_PREFIX}${normalizedVersion}:${encodedTokenValue}`;
};

const resolveSyncTokenForWindow = (
  storedSyncToken: string | null,
  requiredSyncWindowVersion: number,
): ResolvedSyncToken => {
  if (storedSyncToken === null) {
    return {
      requiresBackfill: false,
      syncToken: null,
    };
  }

  const decodedSyncToken = decodeStoredSyncToken(storedSyncToken);
  const machineResolution = resolveSyncTokenFromMachine({
    loadedWindowVersion: decodedSyncToken.syncWindowVersion,
    requiredWindowVersion: requiredSyncWindowVersion,
    token: decodedSyncToken.syncToken,
  });
  return {
    requiresBackfill: machineResolution.requiresBackfill,
    syncToken: machineResolution.resolvedToken,
  };
};

export { decodeStoredSyncToken, encodeStoredSyncToken, resolveSyncTokenForWindow };
