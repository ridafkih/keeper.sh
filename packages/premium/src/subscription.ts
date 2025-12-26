import { database } from "@keeper.sh/database";
import { userSubscriptionsTable } from "@keeper.sh/database/schema";
import { eq } from "drizzle-orm";
import {
  FREE_SOURCE_LIMIT,
  PRO_SOURCE_LIMIT,
  FREE_DESTINATION_LIMIT,
  PRO_DESTINATION_LIMIT,
  planSchema,
  type Plan,
} from "./constants";

export async function getUserPlan(userId: string): Promise<Plan> {
  const [subscription] = await database
    .select({ plan: userSubscriptionsTable.plan })
    .from(userSubscriptionsTable)
    .where(eq(userSubscriptionsTable.userId, userId))
    .limit(1);

  return planSchema.assert(subscription?.plan ?? "free");
}

export function getSourceLimit(plan: Plan): number {
  return plan === "pro" ? PRO_SOURCE_LIMIT : FREE_SOURCE_LIMIT;
}

export async function canAddSource(
  userId: string,
  currentCount: number,
): Promise<boolean> {
  const plan = await getUserPlan(userId);
  const limit = getSourceLimit(plan);
  return currentCount < limit;
}

export function getDestinationLimit(plan: Plan): number {
  return plan === "pro" ? PRO_DESTINATION_LIMIT : FREE_DESTINATION_LIMIT;
}

export async function canAddDestination(
  userId: string,
  currentCount: number,
): Promise<boolean> {
  const plan = await getUserPlan(userId);
  const limit = getDestinationLimit(plan);
  return currentCount < limit;
}
