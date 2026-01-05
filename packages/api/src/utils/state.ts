interface SocketTokenEntry {
  userId: string;
  timeout: ReturnType<typeof setTimeout>;
}

// TODO: Move to Redis
const socketTokens = new Map<string, SocketTokenEntry>();

const validateSocketToken = (token: string): string | null => {
  const tokenEntry = socketTokens.get(token);
  if (!tokenEntry) {
    return null;
  }
  clearTimeout(tokenEntry.timeout);
  socketTokens.delete(token);
  return tokenEntry.userId;
};

export { socketTokens, validateSocketToken };
