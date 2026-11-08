/** Baseline security headers applied to every response. A strict
 *  Content-Security-Policy is intentionally left out here: it needs testing
 *  against Stripe, the inline theme script and remote images before enabling. */
const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(self), interest-cohort=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "images.unsplash.com" },
      // Neon Object Storage (public_read buckets)
      { protocol: "https", hostname: "**.aws.neon.tech" },
      { protocol: "https", hostname: "**.neon.tech" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
