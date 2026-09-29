import { withAuth, withWideEvent } from "@/utils/middleware";
import { pollGraphSession } from "@/utils/graph-oauth-session";
const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    try {
      const body = (await request.json()) as { sessionId?: unknown };
      if (typeof body.sessionId !== "string") {
        throw new TypeError("Session required");
      }
      return Response.json(await pollGraphSession(userId, body.sessionId), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return Response.json(
        {
          error:
            "Sign-in failed or expired. Restart the connection and check application permissions.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }),
);
export { POST };
