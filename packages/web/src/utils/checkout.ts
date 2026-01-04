import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import {
  checkoutSuccessEventSchema,
  type CheckoutSuccessEvent,
} from "@keeper.sh/data-schemas";
import { authClient } from "@/lib/auth-client";

interface CheckoutOptions {
  onSuccess?: (data: CheckoutSuccessEvent) => void;
}

export async function openCheckout(
  productId: string,
  options?: CheckoutOptions,
) {
  const response = await authClient.checkout({
    products: [productId],
    redirect: false,
    embedOrigin: window.location.origin,
  });

  if (!response.data?.url) {
    throw new Error("Failed to create checkout session");
  }

  const checkout = await PolarEmbedCheckout.create(response.data.url, "light");

  checkout.addEventListener("success", (event) => {
    const detail = event.detail;
    if (!checkoutSuccessEventSchema.allows(detail)) {
      options?.onSuccess?.({});
      return;
    }
    options?.onSuccess?.(detail);
  });
}

export async function openCustomerPortal() {
  await authClient.customer.portal();
}
