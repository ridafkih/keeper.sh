"use client";

import { Receipt } from "lucide-react";
import { Separator } from "@base-ui/react/separator";
import { EmptyState } from "@/components/empty-state";
import { SubscriptionPlans } from "@/components/subscription-plans";
import { PageContent } from "@/components/page-content";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { TextMeta, FieldValue } from "@/components/typography";
import { useSubscription } from "@/hooks/use-subscription";
import { useOrders } from "@/hooks/use-orders";
import { formatDate } from "@keeper.sh/date-utils";
import { CustomerOrder } from "@polar-sh/sdk/models/components/customerorder.js";

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(amount / 100);
}

function BillingHistoryLoading() {
  return (
    <Section>
      <SectionHeader
        title="Billing History"
        description="View your past invoices and payment history"
      />
      <div className="py-4 border border-border rounded-md">
        <div className="animate-pulse space-y-2 px-3">
          <div className="h-3 bg-surface-skeleton rounded w-3/4" />
          <div className="h-3 bg-surface-skeleton rounded w-1/2" />
        </div>
      </div>
    </Section>
  );
}

function BillingHistoryEmpty() {
  return (
    <Section>
      <SectionHeader
        title="Billing History"
        description="View your past invoices and payment history"
      />
      <EmptyState
        icon={<Receipt size={20} className="text-foreground-subtle" />}
        message="No billing history yet"
      />
    </Section>
  );
}

interface Order {
  id: string;
  createdAt: Date;
  product?: { name: string };
  description?: string;
  totalAmount: number;
  currency: string;
  paid: boolean;
}

function BillingHistoryTable({ orders }: { orders: CustomerOrder[] }) {
  return (
    <Section>
      <SectionHeader
        title="Billing History"
        description="View your past invoices and payment history"
      />
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-subtle border-b border-border">
            <tr>
              <th className="px-3 py-2 text-left">
                <TextMeta>Date</TextMeta>
              </th>
              <th className="px-3 py-2 text-left">
                <TextMeta>Description</TextMeta>
              </th>
              <th className="px-3 py-2 text-left">
                <TextMeta>Amount</TextMeta>
              </th>
              <th className="px-3 py-2 text-left">
                <TextMeta>Status</TextMeta>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {orders.map((order) => (
              <tr key={order.id}>
                <td className="px-3 py-2">
                  <FieldValue>{formatDate(order.createdAt)}</FieldValue>
                </td>
                <td className="px-3 py-2">
                  <FieldValue>
                    {order.product?.name ?? order.description}
                  </FieldValue>
                </td>
                <td className="px-3 py-2">
                  <FieldValue className="tabular-nums">
                    {formatCurrency(order.totalAmount, order.currency)}
                  </FieldValue>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      order.paid
                        ? "text-success-emphasis bg-success-surface px-1.5 py-0.5 rounded-full text-xs font-medium"
                        : "text-warning bg-warning-surface px-1.5 py-0.5 rounded-full text-xs font-medium"
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

function BillingHistory() {
  const { data: orders, isLoading } = useOrders();

  if (isLoading) {
    return <BillingHistoryLoading />;
  }

  if (!orders || orders.length === 0) {
    return <BillingHistoryEmpty />;
  }

  return <BillingHistoryTable orders={orders} />;
}

export function BillingPageContent() {
  const { data: subscription, isLoading, mutate } = useSubscription();

  return (
    <PageContent>
      <SubscriptionPlans
        currentPlan={subscription?.plan}
        currentInterval={subscription?.interval}
        isSubscriptionLoading={isLoading}
        onSubscriptionChange={mutate}
      />
      <Separator className="bg-border h-px" />
      <BillingHistory />
    </PageContent>
  );
}
