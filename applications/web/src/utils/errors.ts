import { readApiErrorMessage } from "@keeper.sh/data-schemas";
import { HttpError } from "@/lib/fetcher";

export function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) {
    return readApiErrorMessage(error.body) ?? error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
