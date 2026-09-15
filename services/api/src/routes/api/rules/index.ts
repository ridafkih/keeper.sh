import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { createRule, ensureDefaultRule, listRules } from "@/utils/sync-rules";
import { handleCreateRuleRoute, handleListRulesRoute } from "@/handlers/sync-rule-routes";

const GET = withWideEvent(
  withAuth(({ userId }) => handleListRulesRoute(
    { userId },
    {
      ensureDefaultRule: (resolvedUserId) => ensureDefaultRule(database, resolvedUserId),
      listRules: (resolvedUserId) => listRules(database, resolvedUserId),
    },
  )),
);

const POST = withWideEvent(
  withAuth(async ({ request, userId }) => {
    const payload = await request.json();
    return handleCreateRuleRoute({ body: payload, userId }, { createRule });
  }),
);

export { GET, POST };
