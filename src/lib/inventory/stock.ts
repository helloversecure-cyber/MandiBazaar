import { InventoryTxnType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient;

async function getAvailable(
  tx: Tx,
  productId: string,
  variantId?: string | null
) {
  if (variantId) {
    // Lock the row first so concurrent reserve/release/finalize on the same
    // variant serialize — the read-then-increment below can't oversell.
    await tx.$queryRaw`SELECT id FROM "ProductVariant" WHERE id = ${variantId} FOR UPDATE`;
    const v = await tx.productVariant.findUniqueOrThrow({ where: { id: variantId } });
    return { stock: v.stockQuantity, reserved: v.reservedStock, available: v.stockQuantity - v.reservedStock };
  }
  await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
  return { stock: p.stockQuantity, reserved: p.reservedStock, available: p.stockQuantity - p.reservedStock };
}

export async function reserveStock(
  tx: Tx,
  opts: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    orderId: string;
    createdById?: string;
  }
) {
  const { productId, variantId, quantity, orderId, createdById } = opts;
  const current = await getAvailable(tx, productId, variantId);
  if (current.available < quantity) {
    throw new Error("Insufficient stock available");
  }

  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { reservedStock: { increment: quantity } },
    });
  } else {
    await tx.product.update({
      where: { id: productId },
      data: { reservedStock: { increment: quantity } },
    });
  }

  await tx.inventoryTransaction.create({
    data: {
      productId,
      variantId: variantId || null,
      type: InventoryTxnType.RESERVE,
      quantity,
      previousStock: current.stock,
      newStock: current.stock,
      orderId,
      note: `Reserved ${quantity} for order`,
      createdById,
    },
  });
}

export async function releaseReservedStock(
  tx: Tx,
  opts: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    orderId: string;
    createdById?: string;
  }
) {
  const { productId, variantId, quantity, orderId, createdById } = opts;
  const current = await getAvailable(tx, productId, variantId);
  const releaseQty = Math.min(quantity, Math.max(0, current.reserved));
  if (releaseQty <= 0) {
    return; // already released (idempotent)
  }

  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { reservedStock: { decrement: releaseQty } },
    });
  } else {
    await tx.product.update({
      where: { id: productId },
      data: { reservedStock: { decrement: releaseQty } },
    });
  }

  await tx.inventoryTransaction.create({
    data: {
      productId,
      variantId: variantId || null,
      type: InventoryTxnType.RELEASE,
      quantity: releaseQty,
      previousStock: current.stock,
      newStock: current.stock,
      orderId,
      note: `Released ${releaseQty} from reservation`,
      createdById,
    },
  });
}

export async function finalizeSale(
  tx: Tx,
  opts: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    orderId: string;
    createdById?: string;
  }
) {
  const { productId, variantId, quantity, orderId, createdById } = opts;
  // Idempotent: if this order already recorded a SALE for this product/variant,
  // don't decrement stock or increment soldQuantity again (guards double-deliver).
  const alreadyFinalized = await tx.inventoryTransaction.findFirst({
    where: {
      orderId,
      productId,
      variantId: variantId || null,
      type: InventoryTxnType.SALE,
    },
    select: { id: true },
  });
  if (alreadyFinalized) return;
  const current = await getAvailable(tx, productId, variantId);
  const newStock = current.stock - quantity;
  if (newStock < 0) throw new Error("Insufficient stock to finalize sale");
  const releaseReserved = Math.min(quantity, Math.max(0, current.reserved));

  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: {
        stockQuantity: { decrement: quantity },
        reservedStock: { decrement: releaseReserved },
      },
    });
  }

  await tx.product.update({
    where: { id: productId },
    data: {
      stockQuantity: variantId ? undefined : { decrement: quantity },
      reservedStock: variantId ? undefined : { decrement: releaseReserved },
      soldQuantity: { increment: quantity },
    },
  });

  await tx.inventoryTransaction.create({
    data: {
      productId,
      variantId: variantId || null,
      type: InventoryTxnType.SALE,
      quantity,
      previousStock: current.stock,
      newStock,
      orderId,
      note: `Finalized sale of ${quantity}`,
      createdById,
    },
  });
}

/**
 * Reverse a finalized sale when a DELIVERED order is RETURNED: add the units back
 * to stock, reduce soldQuantity, and record a RETURN transaction. Idempotent per
 * (order, product, variant).
 */
export async function restockReturnedSale(
  tx: Tx,
  opts: {
    productId: string;
    variantId?: string | null;
    quantity: number;
    orderId: string;
    createdById?: string;
  }
) {
  const { productId, variantId, quantity, orderId, createdById } = opts;
  const already = await tx.inventoryTransaction.findFirst({
    where: { orderId, productId, variantId: variantId || null, type: InventoryTxnType.RETURN },
    select: { id: true },
  });
  if (already) return;
  const current = await getAvailable(tx, productId, variantId);
  const newStock = current.stock + quantity;
  if (variantId) {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { stockQuantity: { increment: quantity } },
    });
  }
  await tx.product.update({
    where: { id: productId },
    data: {
      stockQuantity: variantId ? undefined : { increment: quantity },
      soldQuantity: { decrement: quantity },
    },
  });
  await tx.inventoryTransaction.create({
    data: {
      productId,
      variantId: variantId || null,
      type: InventoryTxnType.RETURN,
      quantity,
      previousStock: current.stock,
      newStock,
      orderId,
      note: `Returned ${quantity}`,
      createdById,
    },
  });
}

export async function adjustStock(
  productId: string,
  quantity: number,
  note: string,
  createdById?: string,
  variantId?: string
) {
  return prisma.$transaction(async (tx) => {
    if (!Number.isInteger(quantity) || quantity === 0) {
      throw new Error("Quantity must be a whole number other than zero");
    }
    const current = await getAvailable(tx, productId, variantId);
    const newStock = current.stock + quantity;
    if (newStock < 0) throw new Error("Stock cannot be negative");
    // QA S15: never take stock below what is already reserved for open orders
    if (quantity < 0 && newStock < current.reserved) {
      throw new Error(
        `Stock can't go below the ${current.reserved} unit(s) reserved for open orders`
      );
    }

    if (variantId) {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: newStock },
      });
    } else {
      await tx.product.update({
        where: { id: productId },
        data: { stockQuantity: newStock },
      });
    }

    return tx.inventoryTransaction.create({
      data: {
        productId,
        variantId: variantId || null,
        type: quantity >= 0 ? InventoryTxnType.STOCK_IN : InventoryTxnType.STOCK_OUT,
        quantity: Math.abs(quantity),
        previousStock: current.stock,
        newStock,
        note,
        createdById,
      },
    });
  });
}
