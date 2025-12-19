"use client";

import { Separator } from "@base-ui-components/react/separator";
import { SubscriptionPlans } from "@/components/subscription-plans";
import { useSubscription } from "@/hooks/use-subscription";

function BillingHistory() {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Billing History</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          View your past invoices and payment history
        </p>
      </div>
      <div className="text-sm text-gray-500 py-4 border border-gray-200 rounded-lg text-center">
        No billing history yet
      </div>
    </section>
  );
}

export default function BillingPage() {
  const { data: subscription, isLoading, mutate } = useSubscription();

  return (
    <div className="flex-1 flex flex-col gap-8">
      <SubscriptionPlans
        currentPlan={subscription?.plan}
        currentInterval={subscription?.interval}
        isSubscriptionLoading={isLoading}
        onSubscriptionChange={mutate}
      />
      <Separator className="bg-gray-200 h-px" />
      <BillingHistory />
    </div>
  );
}
