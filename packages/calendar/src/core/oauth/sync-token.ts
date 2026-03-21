import { resolveSyncTokenFromMachine } from "./sync-token-strategy-runtime";

const VERSIONED_SYNC_TOKEN_PREFIX = "keeper:sync-token:";

interface DecodedSyncToken {
  syncToken: string;
  syncWindowVersion: number;
}

interface ResolvedSyncToken {
  syncToken: string | null;
  requiresBackfill: boolean;
}

const parseVersionNumber = (value: string): number | null => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
};

const decodeStoredSyncToken = (storedSyncToken: string): DecodedSyncToken | null => {
  if (!storedSyncToken.startsWith(VERSIONED_SYNC_TOKEN_PREFIX)) {
    return null;
  }

  const serializedValue = storedSyncToken.slice(VERSIONED_SYNC_TOKEN_PREFIX.length);
  const separatorIndex = serializedValue.indexOf(":");

  if (separatorIndex <= 0 || separatorIndex === serializedValue.length - 1) {
    return null;
  }

  const versionValue = serializedValue.slice(0, separatorIndex);
  const encodedTokenValue = serializedValue.slice(separatorIndex + 1);

  const parsedVersion = parseVersionNumber(versionValue);
  if (parsedVersion === null) {
    return null;
  }

  try {
    const decodedToken = Buffer.from(encodedTokenValue, "base64url").toString("utf8");
    if (decodedToken.length === 0) {
      return null;
    }

    return {
      syncToken: decodedToken,
      syncWindowVersion: parsedVersion,
    };
  } catch {
    return null;
  }
};

const encodeStoredSyncToken = (
  syncToken: string,
  syncWindowVersion: number,
): string => {
  const encodedTokenValue = Buffer.from(syncToken, "utf8").toString("base64url");
  const normalizedVersion = parseVersionNumber(String(syncWindowVersion)) ?? 0;
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
  if (decodedSyncToken === null) {
    return {
      requiresBackfill: true,
      syncToken: null,
    };
  }
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
