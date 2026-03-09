import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { resolveAuthRedirect } from "../../lib/route-access-guards";

export const Route = createFileRoute("/(auth)")({
  beforeLoad: ({ context }) => {
    const redirectTarget = resolveAuthRedirect(context.auth.hasSession());
    if (redirectTarget) {
      throw redirect({ to: redirectTarget });
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <div className="flex flex-col items-center justify-center min-h-dvh px-2">
      <div className="flex flex-col gap-2 w-full max-w-xs">
        <Outlet />
      </div>
    </div>
  );
}
