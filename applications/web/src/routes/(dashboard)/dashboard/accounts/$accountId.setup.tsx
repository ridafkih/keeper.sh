import { createFileRoute, redirect } from "@tanstack/react-router";

// The per-account wizard became the setup page; old links, history and callbacks from an older API still land here.
export const Route = createFileRoute("/(dashboard)/dashboard/accounts/$accountId/setup")({
  beforeLoad: ({ params }) => {
    throw redirect({ replace: true, search: { accountId: params.accountId }, to: "/dashboard/setup" });
  },
});
