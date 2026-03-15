import { runApiWideEventContext, setWideEventFields, widelog } from "./logging";

type BackgroundJobCallback<TResult> = () => Promise<TResult>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const spawnBackgroundJob = <TResult>(
  jobName: string,
  fields: Record<string, unknown>,
  callback: BackgroundJobCallback<TResult>,
): void => {
  runApiWideEventContext(async () => {
    setWideEventFields({
      ...fields,
      job: {
        name: jobName,
      },
      operation: {
        name: jobName,
        type: "background-job",
      },
      request: {
        id: crypto.randomUUID(),
      },
    });

    try {
      await widelog.time.measure("duration_ms", async () => {
        try {
          const result = await callback();
          if (isRecord(result)) {
            setWideEventFields(result);
          }
          widelog.set("outcome", "success");
          widelog.set("status_code", 200);
        } catch (error) {
          widelog.set("outcome", "error");
          widelog.set("status_code", 500);
          widelog.errorFields(error);
        }
      });
    } finally {
      widelog.flush();
    }
  });
};

export { spawnBackgroundJob };
