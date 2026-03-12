import { withWideEvent } from "../../utils/middleware";

const GET = withWideEvent(() =>
  Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  }),
);

export { GET };
