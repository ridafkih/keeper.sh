import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/connect")({
  component: ConnectLayout,
});

function ConnectLayout() {
  return <Outlet />;
}
