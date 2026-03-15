import { HTTP_STATUS } from "@keeper.sh/constants";
import { apiTokensTable } from "@keeper.sh/database/schema";
import { desc, eq } from "drizzle-orm";
import { database } from "../../../context";
import { withAuth, withWideEvent } from "../../../utils/middleware";
import { ErrorResponse } from "../../../utils/responses";
import {
  generateApiToken,
  hashApiToken,
  extractTokenPrefix,
} from "../../../utils/api-tokens";
import { respondWithLoggedError } from "../../../utils/logging";
import { tokenCreateBodySchema } from "../../../utils/request-body";

const GET = withWideEvent(
  withAuth(async ({ userId }) => {
    const tokens = await database
      .select({
        id: apiTokensTable.id,
        name: apiTokensTable.name,
        tokenPrefix: apiTokensTable.tokenPrefix,
        lastUsedAt: apiTokensTable.lastUsedAt,
        expiresAt: apiTokensTable.expiresAt,
        createdAt: apiTokensTable.createdAt,
      })
      .from(apiTokensTable)
      .where(eq(apiTokensTable.userId, userId))
      .orderBy(desc(apiTokensTable.createdAt));

    return Response.json(tokens);
  }),
);

const POST = withWideEvent(
  withAuth(async ({ userId, request }) => {
    const body = await request.json();

    try {
      const { name } = tokenCreateBodySchema.assert(body);

      if (name.trim().length === 0) {
        return ErrorResponse.badRequest("Token name cannot be empty.").toResponse();
      }

      const plainToken = generateApiToken();
      const tokenHash = hashApiToken(plainToken);
      const tokenPrefix = extractTokenPrefix(plainToken);

      const [created] = await database
        .insert(apiTokensTable)
        .values({
          userId,
          name: name.trim(),
          tokenHash,
          tokenPrefix,
        })
        .returning({
          id: apiTokensTable.id,
          name: apiTokensTable.name,
          tokenPrefix: apiTokensTable.tokenPrefix,
          createdAt: apiTokensTable.createdAt,
        });

      return Response.json(
        {
          ...created,
          token: plainToken,
        },
        { status: HTTP_STATUS.CREATED },
      );
    } catch (error) {
      return respondWithLoggedError(
        error,
        ErrorResponse.badRequest("Token name is required.").toResponse(),
      );
    }
  }),
);

export { GET, POST };
