import { TOKEN_TTL_MS } from "@keeper.sh/constants";
import { redis } from "../context";

const SOCKET_TOKEN_PREFIX = "socket:token:";
const TOKEN_TTL_SECONDS = Math.ceil(TOKEN_TTL_MS / 1000);

const getTokenKey = (token: string): string => `${SOCKET_TOKEN_PREFIX}${token}`;

const generateSocketToken = async (userId: string): Promise<string> => {
  const token = crypto.randomUUID();
  const key = getTokenKey(token);
  await redis.set(key, userId);
  await redis.expire(key, TOKEN_TTL_SECONDS);
  return token;
};

const validateSocketToken = async (token: string): Promise<string | null> => {
  const key = getTokenKey(token);
  const userId = await redis.get(key);
  if (!userId) {
    return null;
  }
  await redis.del(key);
  return userId;
};

export { generateSocketToken, validateSocketToken };
