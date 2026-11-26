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
  // `next dev` only: keep compiled routes in memory for the whole session. The
  // default drops a route after 60 s unused (and keeps just 5), so the browser
  // tests — which revisit every page once per width, minutes apart — recompile
  // each route on every visit; on a 2-vCPU CI runner that stalls page data
  // requests for several seconds. No effect on `next build` / `next start`.
  onDemandEntries: {
    maxInactiveAge: 60 * 60 * 1000,
    pagesBufferLength: 500,
  },
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
  // M-16: the portals live at /store-portal and /rider-portal. Send the obvious
  // wrong guesses there instead of showing a 404.
  async redirects() {
    return [
      { source: "/rider", destination: "/rider-portal", permanent: false },
      { source: "/store/orders", destination: "/store-portal/orders", permanent: false },
    ];
  },
};

export default nextConfig;
