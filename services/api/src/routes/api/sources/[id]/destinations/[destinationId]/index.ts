import { withAuth, withWideEvent } from "@/utils/middleware";
import { database, premiumService } from "@/context";
import {
  readMappingSyncRules,
  writeMappingSyncRuleOverrides,
} from "@/utils/mapping-sync-rules";
import {
  countEffectiveUserMappings,
  MAPPING_LIMIT_ERROR_MESSAGE,
  scheduleMappingReplacementSync,
} from "@/utils/source-destination-mappings";
import {
  handleGetMappingSyncRulesRoute,
  handlePatchMappingSyncRulesRoute,
} from "../../mapping-sync-rules-routes";

const getMappingSyncRules = (
  userId: string,
  sourceCalendarId: string,
  destinationCalendarId: string,
) => readMappingSyncRules(database, userId, sourceCalendarId, destinationCalendarId);

const GET = withWideEvent(
  withAuth(({ params, userId }) =>
    handleGetMappingSyncRulesRoute({ params, userId }, { getMappingSyncRules }),
  ),
);

const PATCH = withWideEvent(
  withAuth(async ({ request, params, userId }) => {
    const body: unknown = await request.json().catch(() => null);
    return handlePatchMappingSyncRulesRoute(
      { body, params, userId },
      {
        canUseEventFilters: (candidateUserId) => premiumService.canUseEventFilters(candidateUserId),
        getMappingSyncRules,
        updateSyncRuleOverrides: async (
          userIdToUpdate,
          sourceCalendarId,
          destinationCalendarId,
          updates,
        ) => {
          const plan = await premiumService.getUserPlan(userIdToUpdate);
          const updated = await writeMappingSyncRuleOverrides(
            database,
            userIdToUpdate,
            sourceCalendarId,
            destinationCalendarId,
            updates,
            {
              countEffectiveMappings: countEffectiveUserMappings,
              limitErrorMessage: MAPPING_LIMIT_ERROR_MESSAGE,
              mappingLimit: premiumService.getMappingLimit(plan),
            },
          );
          if (updated) {
            scheduleMappingReplacementSync(userIdToUpdate);
          }
          return updated;
        },
      },
    );
  }),
);

export { GET, PATCH };
