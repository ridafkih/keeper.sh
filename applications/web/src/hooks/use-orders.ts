import useSWR, { type SWRResponse } from "swr";
import type { CustomerOrder } from "@polar-sh/sdk/models/components/customerorder";
import { authClient } from "@/lib/auth-client";

const fetchOrders = async (): Promise<CustomerOrder[]> => {
  const { data, error } = await authClient.customer.orders.list();
  if (error) {
    return [];
  }
  return data?.result?.items ?? [];
};

export const useOrders = (): SWRResponse<CustomerOrder[]> => useSWR("customer-orders", fetchOrders);
