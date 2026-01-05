import { TOKEN_TTL_MS } from "@keeper.sh/constants";
import { socketTokens } from "./state";

export const generateSocketToken = (userId: string): string => {
  const token = crypto.randomUUID();
  const timeout = setTimeout(() => socketTokens.delete(token), TOKEN_TTL_MS);
  socketTokens.set(token, { timeout, userId });
  return token;
};
