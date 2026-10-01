import type { OnboardingStatus } from "@keeper.sh/data-schemas";
import type { AppJsonFetcher } from "./router-context";

const ONBOARDING_COOKIE_NAME = "keeper.onboarding";

export type OnboardingCookie = "pending" | "done";

export function readOnboardingCookie(cookieHeader?: string): OnboardingCookie | null {
  const cookieSource = cookieHeader
    ?? (typeof document === "undefined" ? "" : document.cookie);
  const prefix = `${ONBOARDING_COOKIE_NAME}=`;
  const cookie = cookieSource
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  const value = cookie?.slice(prefix.length);
  if (value === "pending" || value === "done") return value;
  return null;
}

export const toOnboardingCookie = (status: OnboardingStatus): OnboardingCookie =>
  status === "pending" ? "pending" : "done";

// A failed lookup lets the person through: being sent to onboarding by mistake is worse than missing it.
export async function fetchOnboardingCookie(fetchApi: AppJsonFetcher): Promise<OnboardingCookie | null> {
  try {
    const { status } = await fetchApi<{ status: OnboardingStatus }>("/api/onboarding");
    return toOnboardingCookie(status);
  } catch {
    return null;
  }
}
