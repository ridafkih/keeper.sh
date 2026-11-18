import { resolveHeartbeatFilePath } from "@keeper.sh/heartbeat";

const HEARTBEAT_FILE_PATH = resolveHeartbeatFilePath("worker");

export { HEARTBEAT_FILE_PATH };
