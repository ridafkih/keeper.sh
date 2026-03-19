import { SYNC_TTL_SECONDS } from "@keeper.sh/constants";
import { syncAggregateSchema } from "@keeper.sh/data-schemas";
import type Redis from "ioredis";

const SYNC_PENDING_KEY_PREFIX = "sync:pending:";
const SYNC_AGGREGATE_LATEST_KEY_PREFIX = "sync:aggregate:latest:";
const SYNC_AGGREGATE_SEQUENCE_KEY_PREFIX = "sync:aggregate:seq:";
const SETTINGS_SNAPSHOT_KEY_PREFIX = "sync:settings-snapshot:";
const SETTINGS_DIRTY_KEY_PREFIX = "sync:settings-dirty:";

const SYNC_AFFECTING_FIELDS = [
  "customEventName",
  "excludeAllDayEvents",
  "excludeEventDescription",
  "excludeEventLocation",
  "excludeEventName",
  "excludeFocusTime",
  "excludeOutOfOffice",
  "excludeWorkingLocation",
] as const;

const getSyncPendingKey = (userId: string): string =>
  `${SYNC_PENDING_KEY_PREFIX}${userId}`;

const getSyncAggregateLatestKey = (userId: string): string =>
  `${SYNC_AGGREGATE_LATEST_KEY_PREFIX}${userId}`;

const getSyncAggregateSequenceKey = (userId: string): string =>
  `${SYNC_AGGREGATE_SEQUENCE_KEY_PREFIX}${userId}`;

const getSettingsSnapshotKey = (calendarId: string): string =>
  `${SETTINGS_SNAPSHOT_KEY_PREFIX}${calendarId}`;

const getSettingsDirtyKey = (userId: string): string =>
  `${SETTINGS_DIRTY_KEY_PREFIX}${userId}`;

// --- Ingest / mapping pending (simple flag) ---

const markSyncPending = async (redis: Redis, userId: string): Promise<void> => {
  await redis.set(getSyncPendingKey(userId), new Date().toISOString(), "EX", SYNC_TTL_SECONDS);
};

const clearSyncPending = async (redis: Redis, userId: string): Promise<void> => {
  await redis.del(getSyncPendingKey(userId));
};

const isSyncPending = async (redis: Redis, userId: string): Promise<boolean> => {
  const value = await redis.get(getSyncPendingKey(userId));
  return value !== null;
};

// --- Settings snapshot / dirty tracking ---

const computeSettingsFingerprint = (settings: Record<string, unknown>): string =>
  JSON.stringify(SYNC_AFFECTING_FIELDS.map((field) => [field, settings[field] ?? null]));

const storeSettingsSnapshot = async (
  redis: Redis,
  calendarId: string,
  settings: Record<string, unknown>,
): Promise<void> => {
  const fingerprint = computeSettingsFingerprint(settings);
  await redis.set(getSettingsSnapshotKey(calendarId), fingerprint, "EX", SYNC_TTL_SECONDS);
};

const ensureSettingsSnapshot = async (
  redis: Redis,
  calendarId: string,
  settings: Record<string, unknown>,
): Promise<void> => {
  const key = getSettingsSnapshotKey(calendarId);
  const fingerprint = computeSettingsFingerprint(settings);
  await redis.set(key, fingerprint, "EX", SYNC_TTL_SECONDS, "NX");
};

const reconcileSourceSettings = async (
  redis: Redis,
  userId: string,
  calendarId: string,
  currentSettings: Record<string, unknown>,
): Promise<void> => {
  const snapshot = await redis.get(getSettingsSnapshotKey(calendarId));
  if (!snapshot) {
    return;
  }

  const currentFingerprint = computeSettingsFingerprint(currentSettings);
  const dirtyKey = getSettingsDirtyKey(userId);

  if (currentFingerprint === snapshot) {
    await redis.srem(dirtyKey, calendarId);
  } else {
    await redis.sadd(dirtyKey, calendarId);
    await redis.expire(dirtyKey, SYNC_TTL_SECONDS);
  }
};

const removeFromSettingsDirty = async (
  redis: Redis,
  userId: string,
  calendarIds: string[],
): Promise<void> => {
  if (calendarIds.length === 0) {
    return;
  }
  await redis.srem(getSettingsDirtyKey(userId), ...calendarIds);
};

const clearSettingsDirty = async (redis: Redis, userId: string): Promise<void> => {
  await redis.del(getSettingsDirtyKey(userId));
};

// --- Overall pending ---

const isUserPending = async (redis: Redis, userId: string): Promise<boolean> => {
  const [ingestPending, dirtyCount] = await Promise.all([
    isSyncPending(redis, userId),
    redis.scard(getSettingsDirtyKey(userId)),
  ]);
  return ingestPending || dirtyCount > 0;
};

// --- Broadcast ---

type BroadcastFn = (userId: string, eventName: string, data: unknown) => void;

const buildAggregatePayload = (seq: number, pending: boolean): Record<string, unknown> => ({
  pending,
  progressPercent: 100,
  seq,
  syncEventsProcessed: 0,
  syncEventsRemaining: 0,
  syncEventsTotal: 0,
  syncing: false,
});

const resolveAggregatePayload = (
  cached: string | null,
  seq: number,
  pending: boolean,
): Record<string, unknown> => {
  if (!cached) {
    return buildAggregatePayload(seq, pending);
  }

  const parsed: unknown = JSON.parse(cached);
  if (!syncAggregateSchema.allows(parsed) || typeof parsed !== "object" || parsed === null) {
    return buildAggregatePayload(seq, pending);
  }

  return { ...parsed, pending, seq };
};

const broadcastPendingAggregate = async (
  redis: Redis,
  broadcast: BroadcastFn,
  userId: string,
  pending = true,
): Promise<void> => {
  const latestKey = getSyncAggregateLatestKey(userId);
  const cached = await redis.get(latestKey);

  const sequenceKey = getSyncAggregateSequenceKey(userId);
  const nextSeq = await redis.incr(sequenceKey);
  await redis.expire(sequenceKey, SYNC_TTL_SECONDS);

  const payload = resolveAggregatePayload(cached, nextSeq, pending);

  await redis.set(latestKey, JSON.stringify(payload), "EX", SYNC_TTL_SECONDS);
  broadcast(userId, "sync:aggregate", payload);
};

export {
  SYNC_AFFECTING_FIELDS,
  markSyncPending,
  clearSyncPending,
  isSyncPending,
  storeSettingsSnapshot,
  ensureSettingsSnapshot,
  reconcileSourceSettings,
  removeFromSettingsDirty,
  clearSettingsDirty,
  isUserPending,
  broadcastPendingAggregate,
};
