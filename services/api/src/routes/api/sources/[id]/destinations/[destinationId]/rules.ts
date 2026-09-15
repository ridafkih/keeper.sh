import { withAuth, withWideEvent } from "@/utils/middleware";
import { database } from "@/context";
import { getRuleAssignments, setRuleAssignments } from "@/utils/sync-rules";
import {
  handleGetPairRulesRoute,
  handlePutPairRulesRoute,
} from "@/handlers/sync-rule-assignment-routes";

const GET = withWideEvent(
  withAuth(({ params, userId }) => handleGetPairRulesRoute(
    { params, userId },
    {
      getRuleAssignments: (resolvedUserId, pair) =>
        getRuleAssignments(database, resolvedUserId, pair),
    },
  )),
);

const PUT = withWideEvent(
  withAuth(async ({ params, request, userId }) => {
    const payload = await request.json();
    return handlePutPairRulesRoute({ body: payload, params, userId }, { setRuleAssignments });
  }),
);

export { GET, PUT };
