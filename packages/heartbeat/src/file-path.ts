import { tmpdir } from "node:os";
import { join } from "node:path";

const resolveHeartbeatFilePath = (service: string, directory: string = tmpdir()): string =>
  join(directory, `keeper-${service}.heartbeat.json`);

export { resolveHeartbeatFilePath };
