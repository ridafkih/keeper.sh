import { HttpError } from "@/lib/fetcher";

export function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError) return error.serverMessage ?? fallback;
  if (error instanceof Error) return error.message;
  return fallback;
}
