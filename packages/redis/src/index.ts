import { RedisClient } from "bun";

const createRedis = (url: string): RedisClient => new RedisClient(url);

const createSubscriber = (redis: RedisClient): Promise<RedisClient> => redis.duplicate();

export { createRedis, createSubscriber };
