import { createSyncJob } from "../utils/sync-calendar-events";

export default [
  createSyncJob("free", "@every_30_minutes"),
  createSyncJob("pro", "@every_1_minutes"),
];
