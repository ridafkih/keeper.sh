import { ONBOARDING_COOKIE_NAME, toOnboardingCookie } from "@keeper.sh/data-schemas";
import type { OnboardingCookie, OnboardingStatus } from "@keeper.sh/data-schemas";
import type { AppJsonFetcher } from "./router-context";
import { readCookie } from "./session-cookie";

export type { OnboardingCookie };

export function readOnboardingCookie(cookieHeader?: string): OnboardingCookie | null {
  const value = readCookie(ONBOARDING_COOKIE_NAME, cookieHeader);
  if (value === "pending" || value === "done") return value;
  return null;
}

// A failed lookup lets the person through: being sent to onboarding by mistake is worse than missing it.
export async function fetchOnboardingCookie(fetchApi: AppJsonFetcher): Promise<OnboardingCookie | null> {
  try {
    const { status } = await fetchApi<{ status: OnboardingStatus }>("/api/onboarding");
    return toOnboardingCookie(status);
  } catch {
    return null;
  }
}
