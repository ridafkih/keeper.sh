import { HTTP_STATUS } from "@keeper.sh/constants";
import { apiTokensTable } from "@keeper.sh/database/schema";
import { and, eq } from "drizzle-orm";
import { database } from "@/context";
import { withAuth, withWideEvent } from "@/utils/middleware";
import { ErrorResponse } from "@/utils/responses";

const DELETE = withWideEvent(
  withAuth(async ({ userId, params }) => {
    const tokenId = params.id;

    if (!tokenId) {
      return ErrorResponse.badRequest("Token ID is required.").toResponse();
    }

    const [deleted] = await database
      .delete(apiTokensTable)
      .where(
        and(
          eq(apiTokensTable.id, tokenId),
          eq(apiTokensTable.userId, userId),
        ),
      )
      .returning({ id: apiTokensTable.id });

    if (!deleted) {
      return ErrorResponse.notFound("Token not found.").toResponse();
    }

    return new Response(null, { status: HTTP_STATUS.NO_CONTENT });
  }),
);

export { DELETE };
