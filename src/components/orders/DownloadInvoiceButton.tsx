"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function DownloadInvoiceButton({
  orderNumber,
  variant = "outline",
  size = "md",
  className,
}: {
  orderNumber: string;
  variant?: "primary" | "secondary" | "outline" | "ghost" | "deal";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/orders/${encodeURIComponent(orderNumber)}/invoice`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || "Could not download invoice");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `MandiBazaar-Invoice-${orderNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Could not download invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={busy}
      onClick={download}
    >
      <FileDown className="mr-1.5 h-4 w-4" />
      {busy ? "Preparing…" : "Download invoice"}
    </Button>
  );
}
