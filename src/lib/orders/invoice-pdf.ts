import { jsPDF } from "jspdf";
import { fullCodPaymentLabel } from "@/lib/orders/full-cod";

export type InvoiceOrder = {
  orderNumber: string;
  createdAt: Date | string;
  orderStatus: string;
  paymentMethod: string;
  /** "CASH_ON_DELIVERY" = full cash on delivery (products + delivery fee in cash) */
  deliveryFeePaymentStatus?: string | null;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  grandTotal: number;
  deliveryFeePaid: number;
  productAmountPaid: number;
  remainingAmount: number;
  couponCode?: string | null;
  customer?: {
    fullName?: string | null;
    phone?: string | null;
    email?: string | null;
  } | null;
  deliveryAddressSnapshot: Record<string, string | undefined | null>;
  items: {
    productName: string;
    storeName?: string | null;
    variantName?: string | null;
    quantity: number;
    unit: string;
    unitPrice: number;
    finalPrice: number;
  }[];
};

function money(n: number) {
  return `Rs. ${Number(n || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return d.toLocaleString("en-PK", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildInvoicePdf(order: InvoiceOrder): Uint8Array {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 16;
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(5, 150, 105);
  doc.text("Mandi Bazaar", margin, y);

  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text("INVOICE", pageWidth - margin, y, { align: "right" });

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("mandibazaar.pk · Local stores, delivered", margin, y);
  doc.text(`#${order.orderNumber}`, pageWidth - margin, y, { align: "right" });

  y += 4;
  doc.setDrawColor(209, 250, 229);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text("Bill to", margin, y);
  doc.text("Order details", pageWidth / 2 + 4, y);

  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);

  const address = order.deliveryAddressSnapshot || {};
  const billName = address.fullName || order.customer?.fullName || "Customer";
  const billPhone = address.phone || order.customer?.phone || "—";
  const billLines = [
    billName,
    billPhone,
    order.customer?.email || "",
    [address.houseBuilding, address.area].filter(Boolean).join(", "),
    [address.city, address.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean);

  const detailLines = [
    `Date: ${formatDate(order.createdAt)}`,
    `Status: ${order.orderStatus.replace(/_/g, " ")}`,
    `Payment: ${
      fullCodPaymentLabel({
        deliveryFee: order.deliveryFee,
        deliveryFeePaymentStatus: order.deliveryFeePaymentStatus,
      }) || order.paymentMethod.replace(/_/g, " ")
    }`,
    order.couponCode ? `Coupon: ${order.couponCode}` : "",
  ].filter(Boolean);

  const leftStart = y;
  billLines.forEach((line, i) => {
    doc.text(String(line), margin, leftStart + i * 4.5);
  });
  detailLines.forEach((line, i) => {
    doc.text(String(line), pageWidth / 2 + 4, leftStart + i * 4.5);
  });

  y = leftStart + Math.max(billLines.length, detailLines.length) * 4.5 + 8;

  // Table header
  doc.setFillColor(236, 253, 245);
  doc.rect(margin, y - 4, pageWidth - margin * 2, 8, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(6, 95, 70);
  doc.text("Item", margin + 2, y);
  doc.text("Qty", pageWidth - margin - 52, y, { align: "right" });
  doc.text("Unit", pageWidth - margin - 32, y, { align: "right" });
  doc.text("Amount", pageWidth - margin - 2, y, { align: "right" });

  y += 7;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 41, 59);

  const pageBottom = doc.internal.pageSize.getHeight() - 20;

  for (const item of order.items) {
    const label = item.variantName
      ? `${item.productName} (${item.variantName})`
      : item.productName;
    const storeLine = item.storeName ? `Store: ${item.storeName}` : "";
    const nameLines = doc.splitTextToSize(label, pageWidth - margin * 2 - 60);
    const blockHeight = nameLines.length * 4 + (storeLine ? 3.5 : 0) + 3;

    if (y + blockHeight > pageBottom) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(8);
    doc.setTextColor(15, 23, 42);
    doc.text(nameLines, margin + 2, y);
    doc.text(String(item.quantity), pageWidth - margin - 52, y, {
      align: "right",
    });
    doc.text(money(item.unitPrice), pageWidth - margin - 32, y, {
      align: "right",
    });
    doc.text(money(item.finalPrice), pageWidth - margin - 2, y, {
      align: "right",
    });

    let rowY = y + nameLines.length * 4;
    if (storeLine) {
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`${storeLine} · ${item.unit}`, margin + 2, rowY);
      rowY += 3.5;
    }
    y = rowY + 3;
    doc.setDrawColor(241, 245, 249);
    doc.line(margin, y - 1.5, pageWidth - margin, y - 1.5);
  }

  y += 4;
  if (y + 45 > pageBottom) {
    doc.addPage();
    y = 20;
  }

  const totalsX = pageWidth - margin - 70;
  const valueX = pageWidth - margin - 2;
  const rows: [string, string, boolean?][] = [
    ["Subtotal", money(order.subtotal)],
    ["Discount", `-${money(order.discount)}`],
    ["Delivery fee", money(order.deliveryFee)],
    ["Grand total", money(order.grandTotal), true],
    ["Paid (delivery)", money(order.deliveryFeePaid)],
    ["Paid (products)", money(order.productAmountPaid)],
    [
      order.deliveryFeePaymentStatus === "CASH_ON_DELIVERY" && order.deliveryFee > 0
        ? "Remaining (COD, incl. delivery)"
        : "Remaining (COD)",
      money(order.remainingAmount),
      true,
    ],
  ];

  doc.setFontSize(9);
  for (const [label, value, bold] of rows) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setTextColor(bold ? 15 : 71, bold ? 23 : 85, bold ? 42 : 105);
    doc.text(label, totalsX, y);
    doc.text(value, valueX, y, { align: "right" });
    y += 5.5;
  }

  y += 8;
  doc.setDrawColor(209, 250, 229);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text(
    "Thank you for shopping at Mandi Bazaar. This is a computer-generated invoice.",
    margin,
    y
  );
  y += 4;
  doc.text(
    "For support, contact us via the Mandi Bazaar website or your order page.",
    margin,
    y
  );

  return new Uint8Array(doc.output("arraybuffer"));
}
