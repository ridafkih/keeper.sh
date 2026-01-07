import { WideEvent } from "@keeper.sh/log";

type BackgroundJobCallback<TResult> = () => Promise<TResult>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const getParentFields = (): Record<`parent.${string}`, string> => {
  const parentRequestId = WideEvent.grasp()?.get("request.id") ?? "";

  if (typeof parentRequestId !== 'string') {
    return {}
  }

  return {
    "parent.request.id": parentRequestId,
  }
}

const spawnBackgroundJob = <TResult>(
  jobName: string,
  fields: Record<string, unknown>,
  callback: BackgroundJobCallback<TResult>,
): void => {
  const parentFields = getParentFields();
  const spawnEvent = new WideEvent();

  spawnEvent.set({
    "operation.name": `${jobName}:spawn`,
    "operation.type": "job-spawn",
    "job.name": jobName,
    ...parentFields,
    ...fields,
  });

  spawnEvent.emit();

  const jobEvent = new WideEvent();
  jobEvent.set({
    "operation.name": jobName,
    "operation.type": "background-job",
    "job.name": jobName,
    ...parentFields,
    ...fields,
  });

  jobEvent.run(async () => {
    try {
      const result = await callback();
      if (isRecord(result)) {
        jobEvent.set(result);
      }
    } catch (error) {
      jobEvent.addError(error);
    } finally {
      jobEvent.emit();
    }
  });
};

export { spawnBackgroundJob };
