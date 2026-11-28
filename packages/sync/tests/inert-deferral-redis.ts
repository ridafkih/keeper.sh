const createInertDeferralRedis = () => ({
  expire: () => Promise.resolve(1),
  sadd: () => Promise.resolve(0),
  smembers: (): Promise<string[]> => Promise.resolve([]),
  srem: () => Promise.resolve(0),
});

export { createInertDeferralRedis };
