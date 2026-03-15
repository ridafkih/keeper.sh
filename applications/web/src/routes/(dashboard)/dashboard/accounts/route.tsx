import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/accounts")({
  component: AccountsLayout,
});

function AccountsLayout() {
  return <Outlet />;
}
