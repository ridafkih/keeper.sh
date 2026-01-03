import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/api", "/verify-email", "/forgot-password"],
      },
    ],
    sitemap: "https://keeper.sh/sitemap.xml",
  };
}
