import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/(oauth)/dashboard/connect/microsoft",
)({
  beforeLoad: () => {
    throw redirect({ to: "/dashboard/connect/outlook" });
  },
});
