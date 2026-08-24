const getRuntimeEnvironment = (): string | undefined =>
  process.env.ENV ?? process.env.NODE_ENV ?? globalThis.undefined;

const isTestEnvironment = (): boolean => getRuntimeEnvironment() === "test";

const writeAuthStderr = (message: string): void => {
  if (isTestEnvironment()) {
    return;
  }

  process.stderr.write(message);
};

export { getRuntimeEnvironment, isTestEnvironment, writeAuthStderr };
