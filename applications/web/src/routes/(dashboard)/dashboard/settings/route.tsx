import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/(dashboard)/dashboard/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return <Outlet />;
}
