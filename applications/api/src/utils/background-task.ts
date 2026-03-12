import { widelog } from "./logging";

type BackgroundJobCallback<TResult> = () => Promise<TResult>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const spawnBackgroundJob = <TResult>(
  jobName: string,
  fields: Record<string, unknown>,
  callback: BackgroundJobCallback<TResult>,
): void => {
  widelog.context(async () => {
    widelog.set("operation.name", jobName);
    widelog.set("operation.type", "background-job");
    widelog.set("job.name", jobName);
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        widelog.set(key, value);
      }
    }
    widelog.time.start("duration_ms");

    try {
      const result = await callback();
      if (isRecord(result)) {
        for (const [key, value] of Object.entries(result)) {
          if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
            widelog.set(key, value);
          }
        }
      }
      widelog.set("outcome", "success");
    } catch (error) {
      widelog.set("outcome", "error");
      widelog.errorFields(error);
    } finally {
      widelog.time.stop("duration_ms");
      widelog.flush();
    }
  });
};

export { spawnBackgroundJob };
