import { getSession } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { addressSchema } from "@/lib/validators/schemas";
import { apiError, apiSuccess, apiZodError } from "@/lib/utils";

const MAX_ADDRESSES = 20;

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Address fields for Prisma; clears optional extras that were removed in the form. */
function toData(d: ReturnType<typeof addressSchema.parse>) {
  return {
    label: d.label,
    fullName: d.fullName,
    phone: d.phone,
    houseBuilding: d.houseBuilding,
    street: d.street ?? null,
    area: d.area,
    city: d.city,
    province: d.province,
    postalCode: d.postalCode ?? null,
    nearbyLandmark: d.nearbyLandmark ?? null,
    deliveryInstructions: d.deliveryInstructions ?? null,
    latitude: d.latitude ?? null,
    longitude: d.longitude ?? null,
  };
}

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const addresses = await prisma.address.findMany({
    where: { userId: session.user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return apiSuccess(addresses);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const body = await readJson(req);
  if (!body) return apiError("Invalid request", 400);
  const parsed = addressSchema.safeParse(body);
  if (!parsed.success) return apiZodError(parsed.error);

  const userId = session.user.id;
  const count = await prisma.address.count({ where: { userId } });
  if (count >= MAX_ADDRESSES) {
    return apiError(`You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`, 400);
  }
  // First address becomes the default automatically (QA M2)
  const makeDefault = count === 0 || parsed.data.isDefault === true;

  const address = await prisma.$transaction(async (tx) => {
    if (makeDefault) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.create({
      data: { ...toData(parsed.data), isDefault: makeDefault, userId },
    });
  });
  return apiSuccess(address, 201);
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const userId = session.user.id;
  const body = await readJson(req);
  if (!body) return apiError("Invalid request", 400);
  const { id, ...rest } = body;
  if (typeof id !== "string" || !id) return apiError("Address id is required", 400);

  const existing = await prisma.address.findFirst({ where: { id, userId } });
  if (!existing) return apiError("Address not found", 404);

  // "Make default" only
  const keys = Object.keys(rest);
  if (keys.length === 1 && keys[0] === "isDefault") {
    if (rest.isDefault !== true) return apiError("Choose another address as default instead", 400);
    const address = await prisma.$transaction(async (tx) => {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: { isDefault: true } });
    });
    return apiSuccess(address);
  }

  // Full edit: same rules as create
  const parsed = addressSchema.safeParse(rest);
  if (!parsed.success) return apiZodError(parsed.error);

  const address = await prisma.$transaction(async (tx) => {
    if (parsed.data.isDefault === true) {
      await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
    }
    return tx.address.update({
      where: { id },
      data: {
        ...toData(parsed.data),
        ...(parsed.data.isDefault === true ? { isDefault: true } : {}),
      },
    });
  });
  return apiSuccess(address);
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session?.user?.id) return apiError("Unauthorized", 401);
  const userId = session.user.id;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return apiError("id required");
  const existing = await prisma.address.findFirst({ where: { id, userId } });
  await prisma.address.deleteMany({ where: { id, userId } });
  // Keep one default: promote the newest remaining address
  if (existing?.isDefault) {
    const next = await prisma.address.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    if (next) await prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
  }
  return apiSuccess({ deleted: true });
}
