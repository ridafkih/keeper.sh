import { createFileRoute, redirect } from "@tanstack/react-router";
import { toStringSearchParams } from "@/lib/mcp-auth-flow";

export const Route = createFileRoute("/(oauth)/auth/outlook")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/login", search });
  },
  validateSearch: toStringSearchParams,
});
