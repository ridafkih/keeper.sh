import { createFileRoute, Outlet } from "@tanstack/react-router";
import { readConnectSearch } from "@/lib/connect-return";

export const Route = createFileRoute("/(dashboard)/dashboard/connect")({
  component: ConnectLayout,
  validateSearch: readConnectSearch,
});

function ConnectLayout() {
  return (
    <div className="flex flex-col gap-3">
      <Outlet />
    </div>
  );
}
