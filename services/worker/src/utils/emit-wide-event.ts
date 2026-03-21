import { context, widelog } from "./logging";

const emitWideEvent = async (
  writeFields: () => void | Promise<void>,
): Promise<void> =>
  context(async () => {
    await writeFields();
    widelog.flush();
  });

export { emitWideEvent };
