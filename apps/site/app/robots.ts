import type { MetadataRoute } from "next";

/**
 * noindex until the service is live. Set SITE_INDEXABLE=1 on the production
 * Vercel project to open it up; previews stay closed either way.
 */
export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.SITE_INDEXABLE === "1";
  return {
    rules: indexable ? { userAgent: "*", allow: "/" } : { userAgent: "*", disallow: "/" },
    ...(indexable ? { sitemap: "https://knew.dev/sitemap.xml" } : {}),
  };
}
