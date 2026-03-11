import { feedbackRequestSchema } from "@keeper.sh/data-schemas";
import { feedbackTable } from "@keeper.sh/database/schema";
import { user as userTable } from "@keeper.sh/database/auth-schema";
import { eq } from "drizzle-orm";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import { database, resend, feedbackEmail } from "../../../context";
import { respondWithLoggedError } from "../../../utils/logging";

const TEMPLATE_ID = {
  feedback: "user-feedback",
  report: "problem-report",
} as const;

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const body = await request.json();

    try {
      const { message, type, wantsFollowUp } = feedbackRequestSchema.assert(body);

      await database.insert(feedbackTable).values({
        message,
        type,
        userId,
        wantsFollowUp: wantsFollowUp ?? false,
      });

      if (!resend || !feedbackEmail) {
        return ErrorResponse.internal("Feedback service is not configured.").toResponse();
      }

      const [user] = await database
        .select({ email: userTable.email })
        .from(userTable)
        .where(eq(userTable.id, userId))
        .limit(1);

      if (!user?.email) {
        return ErrorResponse.badRequest("User email not found.").toResponse();
      }

      const templateId = TEMPLATE_ID[type];

      await resend.emails.send({
        template: {
          id: templateId,
          variables: {
            message,
            userEmail: user.email,
            wantsFollowUp: String(wantsFollowUp),
          },
        },
        to: feedbackEmail,
        replyTo: user.email,
      });

      return Response.json({ success: true });
    } catch (error) {
      return respondWithLoggedError(
        error,
        ErrorResponse.badRequest("Invalid feedback request.").toResponse(),
      );
    }
  }),
);

export { POST };
