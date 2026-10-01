import type { OnboardingUpdateBody } from "@keeper.sh/data-schemas";
import { apiFetch } from "@/lib/fetcher";

export async function recordOnboarding(status: OnboardingUpdateBody["status"]): Promise<void> {
  await apiFetch("/api/onboarding", {
    body: JSON.stringify({ status }),
    headers: { "Content-Type": "application/json" },
    method: "PATCH",
  });
}
