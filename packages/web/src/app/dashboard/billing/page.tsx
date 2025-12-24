"use client";

import { Receipt } from "lucide-react";
import { Separator } from "@base-ui-components/react/separator";
import { SubscriptionPlans } from "@/components/subscription-plans";
import { PageContent } from "@/components/page-content";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { useSubscription } from "@/hooks/use-subscription";
import { useOrders } from "@/hooks/use-orders";

function formatCurrency(amount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

const BillingHistoryEmptyState = () => (
  <div className="flex flex-col items-center gap-2 py-6 border border-dashed border-zinc-300 rounded-md">
    <Receipt size={20} className="text-zinc-400" />
    <p className="text-sm text-zinc-600">No billing history yet</p>
  </div>
);

function BillingHistory() {
  const { data: orders, isLoading } = useOrders();

  if (isLoading) {
    return (
      <Section>
        <SectionHeader
          title="Billing History"
          description="View your past invoices and payment history"
        />
        <div className="py-4 border border-zinc-200 rounded-md">
          <div className="animate-pulse space-y-2 px-3">
            <div className="h-3 bg-zinc-200 rounded w-3/4" />
            <div className="h-3 bg-zinc-200 rounded w-1/2" />
          </div>
        </div>
      </Section>
    );
  }

  if (!orders || orders.length === 0) {
    return (
      <Section>
        <SectionHeader
          title="Billing History"
          description="View your past invoices and payment history"
        />
        <BillingHistoryEmptyState />
      </Section>
    );
  }

  return (
    <Section>
      <SectionHeader
        title="Billing History"
        description="View your past invoices and payment history"
      />
      <div className="border border-zinc-200 rounded-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 tracking-tight">
                Date
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 tracking-tight">
                Description
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 tracking-tight">
                Amount
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium text-zinc-500 tracking-tight">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="px-3 py-2 text-sm text-zinc-900 tracking-tight">
                  {formatDate(order.createdAt)}
                </td>
                <td className="px-3 py-2 text-sm text-zinc-900 tracking-tight">
                  {order.product?.name ?? order.description}
                </td>
                <td className="px-3 py-2 text-sm text-zinc-900 tabular-nums tracking-tight">
                  {formatCurrency(order.totalAmount, order.currency)}
                </td>
                <td className="px-3 py-2 text-sm">
                  <span
                    className={
                      order.paid
                        ? "text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full text-xs font-medium"
                        : "text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded-full text-xs font-medium"
                    }
                  >
                    {order.paid ? "Paid" : "Pending"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export default function BillingPage() {
  const { data: subscription, isLoading, mutate } = useSubscription();

  return (
    <PageContent>
      <SubscriptionPlans
        currentPlan={subscription?.plan}
        currentInterval={subscription?.interval}
        isSubscriptionLoading={isLoading}
        onSubscriptionChange={mutate}
      />
      <Separator className="bg-zinc-200 h-px" />
      <BillingHistory />
    </PageContent>
  );
}
