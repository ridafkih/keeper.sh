interface ActiveDestinationJob {
  calendarId: string;
  id: string;
  userId: string;
}

interface ActiveDestinationJobsConfig {
  beginUserRun: (userId: string) => void;
  releaseDelayMs?: number;
  releaseUserRun: (userId: string) => void;
  stalledJobTimeoutMs?: number;
}

interface ActiveDestinationJobs {
  close: () => void;
  onActive: (job: ActiveDestinationJob) => void;
  onSettled: (job: ActiveDestinationJob) => void;
}

const DEFAULT_RELEASE_DELAY_MS = 2000;
/*
 * BullMQ emits `completed`/`failed` only after a Redis round-trip that can reject,
 * so a job can go active and never settle on this worker. Without a watchdog its
 * entry pins the user's syncing hold until the process restarts.
 */
const DEFAULT_STALLED_JOB_TIMEOUT_MS = 600_000;

const createActiveDestinationJobs = (
  config: ActiveDestinationJobsConfig,
): ActiveDestinationJobs => {
  const activeJobsByCalendar = new Map<string, ActiveDestinationJob>();
  const activeDestinationCountsByUser = new Map<string, number>();
  const releaseTimersByUser = new Map<string, ReturnType<typeof setTimeout>>();
  const stalledTimersByCalendar = new Map<string, ReturnType<typeof setTimeout>>();
  const releaseDelayMs = config.releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS;
  const stalledJobTimeoutMs = config.stalledJobTimeoutMs ?? DEFAULT_STALLED_JOB_TIMEOUT_MS;

  const clearStalledWatchdog = (calendarId: string): void => {
    const timer = stalledTimersByCalendar.get(calendarId);
    if (!timer) {
      return;
    }
    clearTimeout(timer);
    stalledTimersByCalendar.delete(calendarId);
  };


  const cancelPendingRelease = (userId: string): boolean => {
    const timer = releaseTimersByUser.get(userId);
    if (!timer) {
      return false;
    }
    clearTimeout(timer);
    releaseTimersByUser.delete(userId);
    return true;
  };



  const onSettled = (job: ActiveDestinationJob): void => {
    const activeJob = activeJobsByCalendar.get(job.calendarId);
    if (activeJob?.id !== job.id) {
      return;
    }

    clearStalledWatchdog(job.calendarId);
    activeJobsByCalendar.delete(job.calendarId);
    const activeCount = activeDestinationCountsByUser.get(job.userId) ?? 0;
    const remainingCount = Math.max(activeCount - 1, 0);
    if (remainingCount > 0) {
      activeDestinationCountsByUser.set(job.userId, remainingCount);
      return;
    }

    activeDestinationCountsByUser.delete(job.userId);
    const timer = setTimeout(() => {
      releaseTimersByUser.delete(job.userId);
      if ((activeDestinationCountsByUser.get(job.userId) ?? 0) === 0) {
        config.releaseUserRun(job.userId);
      }
    }, releaseDelayMs);
    releaseTimersByUser.set(job.userId, timer);
  };

  const armStalledWatchdog = (job: ActiveDestinationJob): void => {
    clearStalledWatchdog(job.calendarId);
    const timer = setTimeout(() => {
      stalledTimersByCalendar.delete(job.calendarId);
      onSettled(job);
    }, stalledJobTimeoutMs);
    stalledTimersByCalendar.set(job.calendarId, timer);
  };

  const onActive = (job: ActiveDestinationJob): void => {
    const aggregateWasHeld = cancelPendingRelease(job.userId);

    const previous = activeJobsByCalendar.get(job.calendarId);
    if (previous) {
      if (previous.id === job.id) {
        return;
      }
      /*
       * Stable job ids mean a replacement only appears across a mixed-version
       * deploy. Mutual exclusion is the Redis lock's job, so track the newer run
       * and let the older one supersede itself rather than cancelling it here.
       */
      activeJobsByCalendar.set(job.calendarId, job);
      armStalledWatchdog(job);
      return;
    }

    const activeCount = activeDestinationCountsByUser.get(job.userId) ?? 0;
    if (activeCount === 0 && !aggregateWasHeld) {
      config.beginUserRun(job.userId);
    }
    activeDestinationCountsByUser.set(job.userId, activeCount + 1);
    activeJobsByCalendar.set(job.calendarId, job);
    armStalledWatchdog(job);
  };

  const close = (): void => {
    for (const timer of stalledTimersByCalendar.values()) {
      clearTimeout(timer);
    }
    stalledTimersByCalendar.clear();
    /*
     * Shutdown runs before worker.close(), so discarding a debounced release would
     * leave the user holding a syncing aggregate nothing clears. Fire them instead.
     */
    for (const [userId, timer] of releaseTimersByUser) {
      clearTimeout(timer);
      config.releaseUserRun(userId);
    }
    releaseTimersByUser.clear();
  };

  return { close, onActive, onSettled };
};

export { createActiveDestinationJobs, DEFAULT_RELEASE_DELAY_MS };
export type {
  ActiveDestinationJob,
  ActiveDestinationJobs,
  ActiveDestinationJobsConfig,
};
