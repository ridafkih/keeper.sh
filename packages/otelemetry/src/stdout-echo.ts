import arkenv from "arkenv";

const PINO_LEVEL_BY_NAME = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
} as const;

const stdoutEchoEnvironmentSchema = {
  STDOUT_LOG_LEVEL: "'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'",
} as const;

const readStdoutEchoLevel = (environment: Record<string, string | undefined>): number => {
  const { STDOUT_LOG_LEVEL } = arkenv(stdoutEchoEnvironmentSchema, { env: environment });
  return PINO_LEVEL_BY_NAME[STDOUT_LOG_LEVEL];
};

const isEchoedToStdout = (level: unknown, minimumLevel: number): boolean => {
  if (typeof level !== "number") {
    return true;
  }
  return level >= minimumLevel;
};

export { isEchoedToStdout, readStdoutEchoLevel };
