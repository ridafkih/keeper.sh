const PUSH_ADMISSION_BUCKET_MS = 10_000;
const PUSH_ADMISSION_PER_BUCKET = 200;
const PUSH_ADMISSION_TTL_SECONDS = (PUSH_ADMISSION_BUCKET_MS / 1000) * 2;
const FIRST_HIT = 1;

interface PushAdmissionRedis {
  expire: (key: string, seconds: number) => Promise<number>;
  incr: (key: string) => Promise<number>;
}

const claimPushAdmission = async (
  redis: PushAdmissionRedis,
  provider: string,
): Promise<boolean> => {
  const bucket = Math.floor(Date.now() / PUSH_ADMISSION_BUCKET_MS);
  const key = `push:admit:${provider}:${bucket}`;
  const count = await redis.incr(key);
  if (count === FIRST_HIT) {
    await redis.expire(key, PUSH_ADMISSION_TTL_SECONDS);
  }
  return count <= PUSH_ADMISSION_PER_BUCKET;
};

export {
  claimPushAdmission,
  PUSH_ADMISSION_BUCKET_MS,
  PUSH_ADMISSION_PER_BUCKET,
  PUSH_ADMISSION_TTL_SECONDS,
};
export type { PushAdmissionRedis };
