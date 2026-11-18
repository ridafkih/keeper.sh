import { resolveHeartbeatFilePath } from "@keeper.sh/heartbeat";

const HEARTBEAT_FILE_PATH = resolveHeartbeatFilePath("cron");

export { HEARTBEAT_FILE_PATH };
