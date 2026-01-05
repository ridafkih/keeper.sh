// oxlint-disable-next-line eslint(no-unassigned-import)
import "./globals.css";

import { Suspense, cache, use } from "react";
import type { ReactNode } from "react";
import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Onest as onest } from "next/font/google";
import { headers } from "next/headers";
import { clsx } from "clsx";
import { AuthProvider } from "@/components/auth-provider";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { AnalyticsContextProvider } from "@/components/analytics-context";
import { GDPR_COUNTRIES } from "@/config/analytics";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/config/site";
import { JsonLd } from "@/components/json-ld";

const font = onest({
  subsets: ["latin"],
});

const metadata: Metadata = {
  alternates: {
    canonical: SITE_URL,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(SITE_URL),
  openGraph: {
    description: SITE_DESCRIPTION,
    locale: "en_US",
    siteName: SITE_NAME,
    title: SITE_NAME,
    type: "website",
    url: SITE_URL,
  },
  robots: {
    follow: true,
    index: true,
  },
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  twitter: {
    card: "summary",
    description: SITE_DESCRIPTION,
    title: SITE_NAME,
  },
};

const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#ffffff",
  width: "device-width",
};

const { NEXT_PUBLIC_VISITORS_NOW_TOKEN } = process.env;

const getCountry = cache(
  (): Promise<string> =>
    headers().then((headers): string => headers.get("x-vercel-ip-country") ?? ""),
);

const Providers = ({ children }: { children: React.ReactNode }): ReactNode => {
  const country = use(getCountry());
  const gdprApplies = GDPR_COUNTRIES.has(country);

  return (
    <AnalyticsContextProvider gdprApplies={gdprApplies}>
      <AuthProvider>
        <div className="isolate min-h-dvh flex flex-col">{children}</div>
      </AuthProvider>
      {NEXT_PUBLIC_VISITORS_NOW_TOKEN && (
        <AnalyticsProvider token={NEXT_PUBLIC_VISITORS_NOW_TOKEN} gdprApplies={gdprApplies} />
      )}
    </AnalyticsContextProvider>
  );
};

const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>): ReactNode => (
  <html lang="en">
    <head>
      <JsonLd />
    </head>
    <body className={clsx(font.className, "bg-background antialiased")}>
      <Suspense>
        <Providers>{children}</Providers>
      </Suspense>
      <Analytics />
    </body>
  </html>
);

export { metadata, viewport };
export default RootLayout;
