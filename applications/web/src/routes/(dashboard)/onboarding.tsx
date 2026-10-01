import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchOnboardingCookie } from "@/lib/onboarding-cookie";
import { readOnboardingSearch } from "@/features/onboarding/onboarding-steps";
import { OnboardingPage } from "@/features/onboarding/components/onboarding-page";

export const Route = createFileRoute("/(dashboard)/onboarding")({
  beforeLoad: async ({ context, search }) => {
    // The live first run stays on screen even though starting the sync already finished onboarding.
    if (search.step === "done" && search.syncId) return;
    const onboarding = context.auth.onboarding() ?? await fetchOnboardingCookie(context.fetchApi);
    if (onboarding === "done") {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: OnboardingRoute,
  validateSearch: readOnboardingSearch,
});

function OnboardingRoute() {
  const search = Route.useSearch();
  return <OnboardingPage search={search} />;
}
