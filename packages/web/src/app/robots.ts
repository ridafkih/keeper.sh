import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        allow: "/",
        disallow: ["/dashboard", "/api", "/verify-email", "/forgot-password"],
        userAgent: "*",
      },
    ],
    sitemap: "https://keeper.sh/sitemap.xml",
  };
}
