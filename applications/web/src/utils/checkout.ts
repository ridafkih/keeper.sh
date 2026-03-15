import { apiFetch } from "../lib/fetcher";

interface CheckoutCallbacks {
  onSuccess?: () => void;
}

interface CheckoutResponse {
  url: string;
}

async function createCheckoutSession(productId: string): Promise<CheckoutResponse> {
  const response = await apiFetch("/api/auth/checkout", {
    body: JSON.stringify({
      embedOrigin: globalThis.location.origin,
      products: [productId],
      redirect: false,
      successUrl: `${globalThis.location.origin}/dashboard`,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return response.json();
}

async function createPortalSession(): Promise<CheckoutResponse> {
  const response = await apiFetch("/api/auth/customer/portal", {
    body: JSON.stringify({ redirect: false }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  return response.json();
}

export async function openCheckout(productId: string, callbacks?: CheckoutCallbacks): Promise<void> {
  const [{ PolarEmbedCheckout }, response] = await Promise.all([
    import("@polar-sh/checkout/embed"),
    createCheckoutSession(productId),
  ]);

  if (!response.url) {
    throw new Error("Failed to create checkout session");
  }

  const checkout = await PolarEmbedCheckout.create(response.url, { theme: "light" });

  checkout.addEventListener("success", () => {
    callbacks?.onSuccess?.();
  });
}

export async function openCustomerPortal(): Promise<void> {
  const response = await createPortalSession();
  if (!response.url) {
    throw new Error("Failed to open customer portal");
  }
  globalThis.location.href = response.url;
}
