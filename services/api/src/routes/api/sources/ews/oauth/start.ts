import { withAuth, withWideEvent } from "@/utils/middleware";
import { startEwsSession } from "@/utils/ews-oauth-session";
const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    try {
      const body = (await request.json()) as { config?: unknown };
      return Response.json(await startEwsSession(userId, body.config), {
        headers: { "Cache-Control": "no-store" },
      });
    } catch {
      return Response.json(
        {
          error:
            "Unable to start OAuth2 user sign-in. Check the application, endpoints, scopes and mailbox.",
        },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
  }),
);
export { POST };
