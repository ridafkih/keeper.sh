import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { deleteRule, findRuleDetail, updateRule } from "@/utils/sync-rules";
import {
  handleDeleteRuleRoute,
  handleGetRuleRoute,
  handlePatchRuleRoute,
} from "@/handlers/sync-rule-routes";

const GET = withWideEvent(
  withAuth(({ params, userId }) => handleGetRuleRoute(
    { params, userId },
    {
      findRule: (resolvedUserId, ruleId) => findRuleDetail(database, resolvedUserId, ruleId),
    },
  )),
);

const PATCH = withWideEvent(
  withAuth(async ({ params, request, userId }) => {
    const payload = await request.json();
    return handlePatchRuleRoute({ body: payload, params, userId }, { updateRule });
  }),
);

const DELETE = withWideEvent(
  withAuth(({ params, userId }) => handleDeleteRuleRoute({ params, userId }, { deleteRule })),
);

export { DELETE, GET, PATCH };
