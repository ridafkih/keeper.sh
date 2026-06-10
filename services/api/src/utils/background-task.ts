import { context, widelog } from "@/utils/logging";

type BackgroundJobCallback<TResult> = () => Promise<TResult>;

const spawnBackgroundJob = <TResult>(
  jobName: string,
  fields: Record<string, unknown>,
  callback: BackgroundJobCallback<TResult>,
): Promise<void> =>
  context(async () => {
    widelog.set("operation.name", jobName);
    widelog.set("operation.type", "background-job");
    widelog.set("request.id", crypto.randomUUID());
    widelog.setFields(fields);

    try {
      await widelog.time.measure("duration_ms", () => callback());
      widelog.set("outcome", "success");
    } catch (error) {
      widelog.set("outcome", "error");
      widelog.errorFields(error, { slug: "unclassified" });
    } finally {
      widelog.flush();
    }
  });

export { spawnBackgroundJob };
