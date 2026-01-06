import { WideEvent, emitWideEvent, runWithWideEvent, getWideEvent, log } from "@keeper.sh/log";
import type { WideEventFields } from "@keeper.sh/log";

type BackgroundJobCallback<TResult> = () => Promise<TResult>;

const isWideEventFields = (value: unknown): value is Partial<WideEventFields> =>
  typeof value === "object" && value !== null;

/**
 * Spawns a background job that runs detached from current request.
 * Emits a spawn event synchronously, then runs job with its own WideEvent.
 * On error: calls log.error() for immediate visibility.
 *
 * Usage: void spawnBackgroundJob(...)
 */
const spawnBackgroundJob = <TResult>(
  jobName: string,
  fields: Partial<WideEventFields>,
  callback: BackgroundJobCallback<TResult>,
): void => {
  const parentRequestId = getWideEvent()?.getRequestId();

  const spawnEvent = new WideEvent("api");
  spawnEvent.set({
    operationName: `${jobName}:spawn`,
    operationType: "job-spawn",
    jobName,
    ...(parentRequestId && { parentRequestId }),
    ...fields,
  });
  emitWideEvent(spawnEvent.finalize());

  const jobEvent = new WideEvent("api");
  jobEvent.set({
    operationName: jobName,
    operationType: "background-job",
    jobName,
    ...(parentRequestId && { parentRequestId }),
    ...fields,
  });

  runWithWideEvent(jobEvent, async () => {
    try {
      const result = await callback();
      if (isWideEventFields(result)) {
        jobEvent.set(result);
      }
    } catch (error) {
      jobEvent.setError(error);
      log.error(
        { jobName, parentRequestId, requestId: jobEvent.getRequestId(), ...fields },
        `Background job failed: ${jobName}`,
      );
    } finally {
      emitWideEvent(jobEvent.finalize());
    }
  });
};

/**
 * Same as spawnBackgroundJob but returns Promise for awaiting.
 * Use in tests or when completion must be awaited.
 */
const runBackgroundJob = async <TResult>(
  jobName: string,
  fields: Partial<WideEventFields>,
  callback: BackgroundJobCallback<TResult>,
): Promise<TResult> => {
  const parentRequestId = getWideEvent()?.getRequestId();

  const spawnEvent = new WideEvent("api");
  spawnEvent.set({
    operationName: `${jobName}:spawn`,
    operationType: "job-spawn",
    jobName,
    ...(parentRequestId && { parentRequestId }),
    ...fields,
  });
  emitWideEvent(spawnEvent.finalize());

  const jobEvent = new WideEvent("api");
  jobEvent.set({
    operationName: jobName,
    operationType: "background-job",
    jobName,
    ...(parentRequestId && { parentRequestId }),
    ...fields,
  });

  const executeJob = async (): Promise<TResult> => {
    try {
      const result = await callback();
      if (isWideEventFields(result)) {
        jobEvent.set(result);
      }
      return result;
    } catch (error) {
      jobEvent.setError(error);
      log.error(
        { jobName, parentRequestId, requestId: jobEvent.getRequestId(), ...fields },
        `Background job failed: ${jobName}`,
      );
      throw error;
    } finally {
      emitWideEvent(jobEvent.finalize());
    }
  };

  return await runWithWideEvent(jobEvent, executeJob);
};

export { spawnBackgroundJob, runBackgroundJob };
