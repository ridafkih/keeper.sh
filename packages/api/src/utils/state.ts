interface SocketTokenEntry {
  userId: string;
  timeout: ReturnType<typeof setTimeout>;
}

// TODO: Move to Redis
const socketTokens = new Map<string, SocketTokenEntry>();

export { socketTokens };
