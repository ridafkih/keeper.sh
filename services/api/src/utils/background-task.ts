type BackgroundJobCallback<TResult> = () => Promise<TResult>;

const spawnBackgroundJob = <TResult>(
  _jobName: string,
  _fields: Record<string, unknown>,
  callback: BackgroundJobCallback<TResult>,
): void => {
  callback().catch(() => null);
};

export { spawnBackgroundJob };
