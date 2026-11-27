"use client";

import { useEffect } from "react";

/**
 * Last-resort error page (the root layout itself failed). Reports the crash
 * once to /api/monitoring/client-error — name, message, digest, short stack
 * and the path only (no query string) — so the owner gets an email alert.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    try {
      const body = JSON.stringify({
        name: error?.name,
        message: error?.message,
        digest: error?.digest,
        stack: (error?.stack || "").split("\n").slice(0, 15).join("\n"),
        path: window.location.pathname,
      });
      void fetch("/api/monitoring/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => undefined);
    } catch {
      // never break the error page
    }
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          padding: 16,
          background: "#fff",
          color: "#111",
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#555", marginBottom: 20 }}>
            We have been notified. Please try again in a few moments.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: "none",
              background: "#15803d",
              color: "#fff",
              fontSize: 15,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
