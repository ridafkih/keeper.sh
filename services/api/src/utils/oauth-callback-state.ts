import { redis } from "../context";

const CALLBACK_STATE_PREFIX = "oauth:callback:";
const CALLBACK_STATE_TTL_SECONDS = 300;

interface OAuthCallbackState {
  credentialId: string;
  provider: string;
}

const getKey = (token: string): string => `${CALLBACK_STATE_PREFIX}${token}`;

const storeCallbackState = async (state: OAuthCallbackState): Promise<string> => {
  const token = crypto.randomUUID();
  const key = getKey(token);
  await redis.set(key, JSON.stringify(state));
  await redis.expire(key, CALLBACK_STATE_TTL_SECONDS);
  return token;
};

const consumeCallbackState = async (token: string): Promise<OAuthCallbackState | null> => {
  const key = getKey(token);
  const value = await redis.get(key);
  if (!value) {
    return null;
  }
  const deleted = await redis.del(key);
  if (!deleted) {
    return null;
  }
  return JSON.parse(value);
};

export { storeCallbackState, consumeCallbackState };
