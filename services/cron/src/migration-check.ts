const MIGRATION_GUIDE_URL = "https://github.com/ridafkih/keeper.sh/issues/260";

const checkWorkerMigrationStatus = (workerJobQueueEnabled: boolean | undefined): void => {
  if (workerJobQueueEnabled === true || workerJobQueueEnabled === false) {
    return;
  }

  const lines = [
    "",
    "╔══════════════════════════════════════════════════════════════╗",
    "║  KEEPER MIGRATION REQUIRED                                 ║",
    "║  A separate worker service is now required for calendar     ║",
    "║  sync. Without it, destination syncing will not function.   ║",
    "╚══════════════════════════════════════════════════════════════╝",
    "",
    "  Starting with this version, the cron service enqueues sync",
    "  jobs to a Redis queue. A separate keeper-worker service",
    "  must be running to process them.",
    "",
    "  To fix this:",
    "",
    "    1. Add the keeper-worker container to your deployment",
    "    2. Set WORKER_JOB_QUEUE_ENABLED=true in the cron environment",
    "",
    "  If you do not want to use the worker service, set",
    "  WORKER_JOB_QUEUE_ENABLED=false to disable job enqueuing.",
    "",
    `  Migration guide: ${MIGRATION_GUIDE_URL}`,
    "",
  ];

  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
};

export { checkWorkerMigrationStatus };
