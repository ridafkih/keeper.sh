interface ActiveDestinationJob {
  calendarId: string;
  id: string;
  userId: string;
}

interface ActiveDestinationJobsConfig {
  beginUserRun: (userId: string) => void;
  cancelJob: (jobId: string) => void;
  releaseDelayMs?: number;
  releaseUserRun: (userId: string) => void;
}

interface ActiveDestinationJobs {
  close: () => void;
  onActive: (job: ActiveDestinationJob) => void;
  onSettled: (job: ActiveDestinationJob) => void;
}

const DEFAULT_RELEASE_DELAY_MS = 2000;

const createActiveDestinationJobs = (
  config: ActiveDestinationJobsConfig,
): ActiveDestinationJobs => {
  const activeJobsByCalendar = new Map<string, ActiveDestinationJob>();
  const activeDestinationCountsByUser = new Map<string, number>();
  const releaseTimersByUser = new Map<string, ReturnType<typeof setTimeout>>();
  const releaseDelayMs = config.releaseDelayMs ?? DEFAULT_RELEASE_DELAY_MS;

  const cancelPendingRelease = (userId: string): boolean => {
    const timer = releaseTimersByUser.get(userId);
    if (!timer) {
      return false;
    }
    clearTimeout(timer);
    releaseTimersByUser.delete(userId);
    return true;
  };

  const onActive = (job: ActiveDestinationJob): void => {
    const aggregateWasHeld = cancelPendingRelease(job.userId);

    const previous = activeJobsByCalendar.get(job.calendarId);
    if (previous) {
      if (previous.id === job.id) {
        return;
      }
      config.cancelJob(previous.id);
      activeJobsByCalendar.set(job.calendarId, job);
      return;
    }

    const activeCount = activeDestinationCountsByUser.get(job.userId) ?? 0;
    if (activeCount === 0 && !aggregateWasHeld) {
      config.beginUserRun(job.userId);
    }
    activeDestinationCountsByUser.set(job.userId, activeCount + 1);
    activeJobsByCalendar.set(job.calendarId, job);
  };

  const onSettled = (job: ActiveDestinationJob): void => {
    const activeJob = activeJobsByCalendar.get(job.calendarId);
    if (activeJob?.id !== job.id) {
      return;
    }

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

  const close = (): void => {
    for (const timer of releaseTimersByUser.values()) {
      clearTimeout(timer);
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
