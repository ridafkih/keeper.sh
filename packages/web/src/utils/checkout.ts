import { PolarEmbedCheckout } from "@polar-sh/checkout/embed";
import { authClient } from "@/lib/auth-client";

interface CheckoutOptions {
  onSuccess?: () => void;
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

  checkout.addEventListener("success", () => {
    options?.onSuccess?.();
  });
}

export async function openCustomerPortal() {
  await authClient.customer.portal();
}
