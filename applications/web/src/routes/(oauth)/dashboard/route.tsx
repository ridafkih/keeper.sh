import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { resolveDashboardRedirect } from "@/lib/route-access-guards";

export const Route = createFileRoute("/(oauth)/dashboard")({
  beforeLoad: ({ context }) => {
    const redirectTarget = resolveDashboardRedirect(context.auth.hasSession());
    if (redirectTarget) {
      throw redirect({ to: redirectTarget });
    }
  },
  component: OAuthDashboardLayout,
});

function OAuthDashboardLayout() {
  return <Outlet />;
}
