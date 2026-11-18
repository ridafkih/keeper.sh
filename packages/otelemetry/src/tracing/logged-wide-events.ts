import { loggedErrorFor, loggedFieldFor } from "./logged-text";

type WideEventField = boolean | number | string;

interface WideEventWriter {
  append: (key: never, value: WideEventField) => unknown;
  errorFields: (error: unknown, options?: never) => unknown;
  set: (key: never, value: WideEventField) => unknown;
  setFields: (fields: Record<string, unknown>) => unknown;
}

const withLoggedText = <Writer extends WideEventWriter>(writer: Writer): Writer => ({
  ...writer,
  append: (key: never, value: WideEventField) => writer.append(key, loggedFieldFor(value)),
  errorFields: (error: unknown, options?: never) => writer.errorFields(loggedErrorFor(error), options),
  set: (key: never, value: WideEventField) => writer.set(key, loggedFieldFor(value)),
  setFields: (fields: Record<string, unknown>) => writer.setFields(loggedFieldFor(fields)),
});

export { withLoggedText };
