import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";
import { widelog } from "@/utils/logging";
import { describeFunnelEvent, parseFunnelEvent } from "@/utils/funnel-events";

const HTTP_NO_CONTENT = 204;

const readJsonBody = (request: Request): Promise<unknown> => request.json().catch(() => null);

const handleFunnelEvent = (body: unknown): Response => {
  const event = parseFunnelEvent(body);
  if (!event) {
    return ErrorResponse.badRequest("Invalid funnel event.").toResponse();
  }
  widelog.setFields(describeFunnelEvent(event));
  return new Response(null, { status: HTTP_NO_CONTENT });
};

const POST = withWideEvent(
  withAuth(async ({ request }) => handleFunnelEvent(await readJsonBody(request))),
);

export { POST, handleFunnelEvent };
