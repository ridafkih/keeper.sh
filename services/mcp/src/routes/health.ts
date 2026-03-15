import { withWideEvent } from "@/context";

const GET = withWideEvent(() =>
  Response.json({ service: "keeper-mcp", status: "ok" }),
);

export { GET };
