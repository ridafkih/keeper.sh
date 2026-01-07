import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import { checkoutSuccessEventSchema, type CheckoutSuccessEvent } from "@keeper.sh/data-schemas";
import { authClient } from "@/lib/auth-client";

interface CheckoutOptions {
  onSuccess?: (data: CheckoutSuccessEvent) => void;
}

const openCheckout = async (productId: string, options?: CheckoutOptions): Promise<void> => {
  const response = await authClient.checkout({
    embedOrigin: globalThis.location.origin,
    products: [productId],
    redirect: false,
  });

  if (!response.data?.url) {
    throw new Error("Failed to create checkout session");
  }

  const checkout = await PolarEmbedCheckout.create(response.data.url, "light");

  checkout.addEventListener("success", (event) => {
    const { detail } = event;
    if (!checkoutSuccessEventSchema.allows(detail)) {
      options?.onSuccess?.({});
      return;
    }
    options?.onSuccess?.(detail);
  });
};

const openCustomerPortal = async (): Promise<void> => {
  await authClient.customer.portal();
};

export { openCheckout, openCustomerPortal };
