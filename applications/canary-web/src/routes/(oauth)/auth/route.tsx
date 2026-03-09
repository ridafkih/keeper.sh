import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { resolveAuthRedirect } from "../../../lib/route-access-guards";

export const Route = createFileRoute("/(oauth)/auth")({
  beforeLoad: ({ context }) => {
    const redirectTarget = resolveAuthRedirect(context.auth.hasSession());
    if (redirectTarget) {
      throw redirect({ to: redirectTarget });
    }
  },
  component: OAuthAuthLayout,
});

function OAuthAuthLayout() {
  return <Outlet />;
}
