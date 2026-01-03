import "./globals.css";

import { Suspense, use, cache } from "react";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Onest } from "next/font/google";
import { headers } from "next/headers";
import clsx from "clsx";
import { AuthProvider } from "@/components/auth-provider";
import { CookieConsent } from "@/components/cookie-consent";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { GDPR_COUNTRIES } from "@/config/analytics";

const font = Onest({
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Keeper",
  description: "Calendar management and synchronization",
};

const { NEXT_PUBLIC_VISITORS_NOW_TOKEN } = process.env;

const getCountry = cache(() => headers().then((h) => h.get("x-vercel-ip-country") ?? ""));

const AnalyticsWrapper = () => {
  const country = use(getCountry());
  const requiresConsent = GDPR_COUNTRIES.has(country);

  return (
    <>
      {requiresConsent && <CookieConsent />}
      {NEXT_PUBLIC_VISITORS_NOW_TOKEN && (
        <AnalyticsProvider
          token={NEXT_PUBLIC_VISITORS_NOW_TOKEN}
          requiresConsent={requiresConsent}
        />
      )}
    </>
  );
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={clsx(font.className, "bg-background antialiased")}>
        <AuthProvider>
          <div className="isolate min-h-dvh flex flex-col">{children}</div>
        </AuthProvider>
        <Suspense>
          <AnalyticsWrapper />
        </Suspense>
        <Analytics />
      </body>
    </html>
  );
}
