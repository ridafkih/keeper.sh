import { createFileRoute, Outlet } from "@tanstack/react-router";
import { readConnectSearch } from "@/lib/connect-return";

export const Route = createFileRoute("/(oauth)/dashboard/connect")({
  component: OAuthConnectLayout,
  validateSearch: readConnectSearch,
});

function OAuthConnectLayout() {
  return (
    <div className="flex flex-col gap-3 w-full max-w-xs self-center">
      <Outlet />
    </div>
  );
}
