"use client";

import type { ReactNode } from "react";
import { Receipt } from "lucide-react";
import { Separator } from "@base-ui/react/separator";
import { EmptyState } from "@/components/empty-state";
import { SubscriptionPlans } from "@/components/subscription-plans";
import { PageContent } from "@/components/page-content";
import { Section } from "@/components/section";
import { SectionHeader } from "@/components/section-header";
import { FieldValue, TextMeta } from "@/components/typography";
import { useSubscription } from "@/hooks/use-subscription";
import { useOrders } from "@/hooks/use-orders";
import { formatDate } from "@keeper.sh/date-utils";
import type { CustomerOrder } from "@polar-sh/sdk/models/components/customerorder.js";

const CENTS_PER_DOLLAR = 100;

const formatCurrency = (amount: number, currency: string): string =>
  new Intl.NumberFormat("en-US", {
    currency: currency.toUpperCase(),
    style: "currency",
  }).format(amount / CENTS_PER_DOLLAR);

const BillingHistoryLoading = (): ReactNode => (
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

const RECEIPT_ICON_SIZE = 20;

const BillingHistoryEmpty = (): ReactNode => (
  <Section>
    <SectionHeader
      title="Billing History"
      description="View your past invoices and payment history"
    />
    <EmptyState
      icon={<Receipt size={RECEIPT_ICON_SIZE} className="text-foreground-subtle" />}
      message="No billing history yet"
    />
  </Section>
);

const BillingHistoryTable = ({ orders }: { orders: CustomerOrder[] }): ReactNode => (
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
                  <FieldValue>{order.product?.name ?? order.description}</FieldValue>
                </td>
                <td className="px-3 py-2">
                  <FieldValue className="tabular-nums">
                    {formatCurrency(order.totalAmount, order.currency)}
                  </FieldValue>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={((): string => {
                      if (order.paid) {
                        return "text-success-emphasis bg-success-surface px-1.5 py-0.5 rounded-full text-xs font-medium";
                      }
                      return "text-warning bg-warning-surface px-1.5 py-0.5 rounded-full text-xs font-medium";
                    })()}
                  >
                    {((): string => {
                      if (order.paid) {
                        return "Paid";
                      }
                      return "Pending";
                    })()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
);

const EMPTY_ORDERS_COUNT = 0;

const BillingHistory = (): ReactNode => {
  const { data: orders, isLoading } = useOrders();

  if (isLoading) {
    return <BillingHistoryLoading />;
  }

  if (!orders || orders.length === EMPTY_ORDERS_COUNT) {
    return <BillingHistoryEmpty />;
  }

  return <BillingHistoryTable orders={orders} />;
};

export const BillingPageContent = (): ReactNode => {
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
};
