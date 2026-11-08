/**
 * Branded transactional email (verify / reset). Table layout + inline styles so
 * it renders consistently across email clients (Gmail, Outlook, Apple Mail).
 * Returns both an HTML body and a plain-text fallback.
 */
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function renderActionEmail(opts: {
  heading: string;
  intro: string;
  buttonLabel: string;
  buttonUrl: string;
  footnote?: string;
}): { html: string; text: string } {
  const { heading, intro, buttonLabel, buttonUrl, footnote } = opts;
  const url = esc(buttonUrl);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light" />
<title>${esc(heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px -12px rgba(2,44,34,0.18);">
        <!-- Brand header -->
        <tr><td style="background:linear-gradient(135deg,#022c22 0%,#065f46 45%,#059669 100%);padding:28px 32px;">
          <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Mandi<span style="color:#6ee7b7;">Bazaar</span></span>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:32px 32px 8px 32px;">
          <h1 style="margin:0 0 10px 0;font-size:20px;font-weight:800;color:#0f172a;">${esc(heading)}</h1>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#475569;">${esc(intro)}</p>
          <!-- Button -->
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#059669" style="border-radius:12px;">
            <a href="${url}" target="_blank" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;background:#059669;">${esc(buttonLabel)}</a>
          </td></tr></table>
          <p style="margin:24px 0 4px 0;font-size:12px;color:#94a3b8;">Button not working? Copy and paste this link:</p>
          <p style="margin:0 0 8px 0;font-size:12px;word-break:break-all;"><a href="${url}" target="_blank" style="color:#059669;">${url}</a></p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px 28px 32px;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8;">${esc(footnote || "If you didn't request this, you can safely ignore this email.")}</p>
          <p style="margin:10px 0 0 0;font-size:12px;color:#cbd5e1;">© MandiBazaar — fresh deals from local mandi stores.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `${heading}\n\n${intro}\n\n${buttonLabel}: ${buttonUrl}\n\n${footnote || "If you didn't request this, you can ignore this email."}`;
  return { html, text };
}
