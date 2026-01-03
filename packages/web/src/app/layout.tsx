import "./globals.css";

import { Suspense, use, cache } from "react";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Onest } from "next/font/google";
import { headers } from "next/headers";
import clsx from "clsx";
import { AuthProvider } from "@/components/auth-provider";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { GDPR_COUNTRIES } from "@/config/analytics";
import { JsonLd } from "@/components/json-ld";

const font = Onest({
  subsets: ["latin"],
});

const SITE_URL = "https://keeper.sh";
const SITE_NAME = "Keeper";
const SITE_DESCRIPTION =
  "Simple, open-source calendar syncing. Aggregate events from multiple calendars into one anonymized feed. Push events to one or many calendars.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: SITE_URL,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

const { NEXT_PUBLIC_VISITORS_NOW_TOKEN } = process.env;

const getCountry = cache(() =>
  headers().then((headers) => headers.get("x-vercel-ip-country") ?? ""),
);

const AnalyticsWrapper = () => {
  const country = use(getCountry());
  const requiresConsent = GDPR_COUNTRIES.has(country);

  if (!NEXT_PUBLIC_VISITORS_NOW_TOKEN) return null;

  return (
    <AnalyticsProvider
      token={NEXT_PUBLIC_VISITORS_NOW_TOKEN}
      requiresConsent={requiresConsent}
    />
  );
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <JsonLd />
      </head>
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
