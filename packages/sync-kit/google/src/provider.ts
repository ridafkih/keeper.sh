import type { CalendarProvider } from "@keeper.sh/sync-protocol";
import type { GoogleDependencies } from "./dependencies";
import { createGoogleInternals } from "./internals";

const createGoogleProvider = (dependencies: GoogleDependencies): CalendarProvider<"google"> =>
  createGoogleInternals(dependencies).provider;

export { createGoogleProvider };
