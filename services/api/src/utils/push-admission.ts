const PUSH_ADMISSION_BUCKET_MS = 10_000;
const PUSH_ADMISSION_PER_BUCKET = 200;
const PUSH_CHANNEL_ADMISSION_PER_BUCKET = 20;
const PUSH_ADMISSION_TTL_SECONDS = (PUSH_ADMISSION_BUCKET_MS / 1000) * 2;
const FIRST_HIT = 1;

interface PushAdmissionRedis {
  expire: (key: string, seconds: number) => Promise<number>;
  incr: (key: string) => Promise<number>;
}

interface PushAdmissionInput {
  channelKey: string | null;
  provider: string;
}

const incrementBucket = async (
  redis: PushAdmissionRedis,
  key: string,
): Promise<number> => {
  const count = await redis.incr(key);
  if (count === FIRST_HIT) {
    await redis.expire(key, PUSH_ADMISSION_TTL_SECONDS);
  }
  return count;
};

const claimPushAdmission = async (
  redis: PushAdmissionRedis,
  input: PushAdmissionInput,
): Promise<boolean> => {
  const bucket = Math.floor(Date.now() / PUSH_ADMISSION_BUCKET_MS);

  if (input.channelKey === null) {
    const providerCount = await incrementBucket(
      redis,
      `push:admit:${input.provider}:${bucket}`,
    );
    return providerCount <= PUSH_ADMISSION_PER_BUCKET;
  }

  const channelCount = await incrementBucket(
    redis,
    `push:admit:${input.provider}:${input.channelKey}:${bucket}`,
  );
  return channelCount <= PUSH_CHANNEL_ADMISSION_PER_BUCKET;
};

export {
  claimPushAdmission,
  PUSH_ADMISSION_BUCKET_MS,
  PUSH_ADMISSION_PER_BUCKET,
  PUSH_ADMISSION_TTL_SECONDS,
  PUSH_CHANNEL_ADMISSION_PER_BUCKET,
};
export type { PushAdmissionInput, PushAdmissionRedis };
