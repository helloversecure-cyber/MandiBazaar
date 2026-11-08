import { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin/",
        "/api/",
        "/account/",
        "/checkout/",
        "/rider-portal/",
        "/register/rider",
        "/login",
        "/store-portal/",
      ],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
