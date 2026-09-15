import { encryptPassword, decryptPassword } from "@keeper.sh/database";
import { beginEwsDeviceAuthorization, pollEwsDeviceAuthorization, EwsError, type EwsConfig } from "@keeper.sh/calendar/ews";
import { redis, encryptionKey } from "@/context";
import { safeFetchOptions } from "@/utils/safe-fetch-options";

interface OAuthDeviceSession {
  config: Pick<EwsConfig, "auth">;
  deviceCode?: string;
  expiresAt: number;
  nextPoll: number;
  interval: number;
  authorized: boolean;
}
// Preserve existing key namespaces and serialized sessions across deployments.
const createOAuthDeviceSessions = <Session extends OAuthDeviceSession>(namespace: "ews" | "graph") => {
  const keyFor = (userId: string, id: string): string => {
    if (!/^[a-f\d-]{36}$/u.test(id)) {
      throw new Error("Invalid session");
    }
    return `${namespace}:oauth:${userId}:${id}`;
  };
  const readSession = async (key: string): Promise<Session> => {
    if (!encryptionKey) {
      throw new Error("Encryption unavailable");
    }
    const value = await redis.get(key);
    if (!value) {
      throw new Error("Connection session expired");
    }
    const session = JSON.parse(decryptPassword(value, encryptionKey)) as Session;
    if (session.expiresAt <= Date.now()) {
      throw new Error("Connection session expired");
    }
    return session;
  };
  const writeSession = async (key: string, session: Session): Promise<void> => {
    if (!encryptionKey) {
      throw new Error("Encryption unavailable");
    }
    const ttl = Math.ceil((session.expiresAt - Date.now()) / 1000);
    if (ttl <= 0) {
      throw new Error("Connection session expired");
    }
    await redis.set(
      key,
      encryptPassword(JSON.stringify(session), encryptionKey),
      "EX",
      ttl,
    );
  };
  const withSession = async <Result>(
    userId: string,
    id: string,
    action: (session: Session) => Promise<Result>,
  ): Promise<Result> => {
    const key = keyFor(userId, id);
    const lockKey = `${key}:lock`;
    const owner = crypto.randomUUID();
    if (!(await redis.set(lockKey, owner, "EX", 180, "NX"))) {
      throw new Error("Connection session busy");
    }
    try {
      const session = await readSession(key);
      const result = await action(session);
      await writeSession(key, session);
      return result;
    } finally {
      await redis.eval(
        'if redis.call("get",KEYS[1]) == ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end',
        1,
        lockKey,
        owner,
      );
    }
  };
  const start = async (userId: string, initial: Omit<Session, "deviceCode" | "expiresAt" | "nextPoll" | "interval" | "authorized">) => {
    if (!encryptionKey) { throw new Error("Encryption unavailable"); }
    const result = await beginEwsDeviceAuthorization(initial.config, {
      safeFetchOptions,
    });
    const sessionId = crypto.randomUUID();
    await writeSession(keyFor(userId, sessionId), {
      ...initial,
      deviceCode: result.deviceCode,
      expiresAt: result.expiresAt,
      interval: result.interval,
      nextPoll: Date.now() + result.interval * 1000,
      authorized: false,
    } as Session);
    return {
      sessionId,
      userCode: result.userCode,
      verificationUri: result.verificationUri,
      expiresAt: result.expiresAt,
      interval: result.interval,
    };
  };
  const poll = (userId: string, id: string) =>
    withSession(userId, id, async (session) => {
      if (session.authorized) {
        return { authorized: true, interval: session.interval };
      }
      if (Date.now() < session.nextPoll) {
        return { authorized: false, interval: session.interval };
      }
      if (!session.deviceCode) {
        throw new Error("Missing authorization");
      }
      let result = "authorization_pending";
      try {
        result = await pollEwsDeviceAuthorization(
          session.config,
          session.deviceCode,
          { safeFetchOptions },
        );
      } catch (error) {
        // Terminal OAuth failures consume the login attempt.
        if (error instanceof EwsError) {
          await redis.del(keyFor(userId, id));
        }
        throw error;
      }
      if (result === "authorized") {
        session.authorized = true;
        delete session.deviceCode;
        session.expiresAt = Date.now() + 900_000;
      }
      if (result === "slow_down") {
        session.interval += 5;
      }
      session.nextPoll = Date.now() + session.interval * 1000;
      return { authorized: session.authorized, interval: session.interval };
    });
  const read = (userId: string, id: string) => readSession(keyFor(userId, id));
  const remove = async (userId: string, id: unknown): Promise<void> => {
    if (typeof id === "string") { await redis.del(keyFor(userId, id)); }
  };
  return { start, poll, read, withSession, remove };
};
export { createOAuthDeviceSessions };
export type { OAuthDeviceSession };
