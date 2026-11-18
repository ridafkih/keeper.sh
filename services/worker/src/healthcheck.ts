import { runHeartbeatCheck } from "@keeper.sh/heartbeat";
import { HEARTBEAT_FILE_PATH } from "./utils/heartbeat-file";

const exitCode = runHeartbeatCheck({ filePath: HEARTBEAT_FILE_PATH }, (line) => {
  process.stdout.write(`${line}\n`);
});

process.exit(exitCode);
