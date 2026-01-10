import Redis from "ioredis";

const createRedis = (url: string): Redis => new Redis(url);

const createSubscriber = (redis: Redis): Redis => redis.duplicate();

export { createRedis, createSubscriber };
