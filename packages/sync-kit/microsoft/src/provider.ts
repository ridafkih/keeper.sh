import type { CalendarProvider } from "@keeper.sh/sync-protocol";
import type { MicrosoftDependencies } from "./dependencies";
import { createMicrosoftInternals } from "./internals";

const createMicrosoftProvider = (
  dependencies: MicrosoftDependencies,
): CalendarProvider<"microsoft"> => createMicrosoftInternals(dependencies).provider;

export { createMicrosoftProvider };
