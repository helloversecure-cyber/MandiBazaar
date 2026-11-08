import { PrismaClient, RoleName } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ROLE_PERMISSIONS, PERMISSIONS } from "../src/lib/auth/permissions";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding MandiBazaar marketplace...");

  for (const code of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { code },
      create: { code, description: code },
      update: {},
    });
  }

  for (const roleName of Object.values(RoleName)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName, description: roleName.replace(/_/g, " ") },
      update: {},
    });

    const perms = ROLE_PERMISSIONS[roleName] || [];
    for (const code of perms) {
      const permission = await prisma.permission.findUnique({ where: { code } });
      if (!permission) continue;
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "SUPER_ADMIN" },
  });
  const storeOwnerRole = await prisma.role.findUniqueOrThrow({
    where: { name: "STORE_OWNER" },
  });
  const customerRole = await prisma.role.findUniqueOrThrow({
    where: { name: "CUSTOMER" },
  });
  const riderRole = await prisma.role.findUniqueOrThrow({
    where: { name: "RIDER" },
  });

  const passwordHash = await bcrypt.hash("Admin@12345", 12);
  const customerHash = await bcrypt.hash("Customer@123", 12);
  const storeHash = await bcrypt.hash("Store@12345", 12);
  const riderHash = await bcrypt.hash("Rider@12345", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@mandibazaar.com" },
    create: {
      email: "admin@mandibazaar.com",
      phone: "03001234569",
      fullName: "MandiBazaar Super Admin",
      passwordHash,
      roleId: superAdminRole.id,
      onboardingCompleted: true,
    },
    update: { passwordHash, roleId: superAdminRole.id, fullName: "MandiBazaar Super Admin", onboardingCompleted: true },
  });

  // Keep legacy emails working
  await prisma.user.upsert({
    where: { email: "admin@discountprice.com" },
    create: {
      email: "admin@discountprice.com",
      phone: "03001234566",
      fullName: "MandiBazaar Super Admin",
      passwordHash,
      roleId: superAdminRole.id,
      onboardingCompleted: true,
    },
    update: { passwordHash, roleId: superAdminRole.id, onboardingCompleted: true },
  });

  await prisma.user.upsert({
    where: { email: "admin@zulaal.com" },
    create: {
      email: "admin@zulaal.com",
      phone: "03001234568",
      fullName: "MandiBazaar Super Admin",
      passwordHash,
      roleId: superAdminRole.id,
      onboardingCompleted: true,
    },
    update: { passwordHash, roleId: superAdminRole.id, onboardingCompleted: true },
  });

  const customer = await prisma.user.upsert({
    where: { phone: "03009876543" },
    create: {
      email: "customer@mandibazaar.com",
      phone: "03009876543",
      fullName: "Ayesha Khan",
      passwordHash: customerHash,
      roleId: customerRole.id,
      onboardingCompleted: true,
    },
    update: { onboardingCompleted: true },
  });

  const storeOwner = await prisma.user.upsert({
    where: { phone: "03005556677" },
    create: {
      email: "owner@freshmart.pk",
      phone: "03005556677",
      fullName: "Imran Store Owner",
      passwordHash: storeHash,
      roleId: storeOwnerRole.id,
      onboardingCompleted: true,
    },
    update: { passwordHash: storeHash, roleId: storeOwnerRole.id, onboardingCompleted: true },
  });

  const riderUser = await prisma.user.upsert({
    where: { phone: "03001112233" },
    create: {
      email: "rider@mandibazaar.com",
      phone: "03001112233",
      fullName: "Ali Rider",
      passwordHash: riderHash,
      roleId: riderRole.id,
      onboardingCompleted: true,
    },
    update: { passwordHash: riderHash, onboardingCompleted: true },
  });

  await prisma.cart.upsert({
    where: { userId: customer.id },
    create: { userId: customer.id },
    update: {},
  });

  await prisma.address.upsert({
    where: { id: "seed-address-home" },
    create: {
      id: "seed-address-home",
      userId: customer.id,
      label: "Home",
      fullName: "Ayesha Khan",
      phone: "03009876543",
      houseBuilding: "House 12, Block B",
      street: "Main Boulevard",
      area: "DHA Phase 5",
      city: "Lahore",
      province: "Punjab",
      postalCode: "54000",
      nearbyLandmark: "Near mosque",
      latitude: 31.4697,
      longitude: 74.4087,
      isDefault: true,
    },
    update: { latitude: 31.4697, longitude: 74.4087 },
  });

  const rider = await prisma.rider.upsert({
    where: { phone: "03001112233" },
    create: {
      name: "Ali Rider",
      phone: "03001112233",
      userId: riderUser.id,
      isActive: true,
      status: "AVAILABLE",
      approvalStatus: "APPROVED",
      approvedAt: new Date(),
      city: "Lahore",
      vehicleType: "Bike",
      cnicNumber: "35202-1234567-1",
      accountNumber: "03001112233",
      accountTitle: "Ali Rider",
      jazzCashNumber: "03001112233",
      photoUrl:
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80",
      cnicUrl:
        "https://images.unsplash.com/photo-1586281380349-632531db7ed4?w=400&q=80",
      licenseUrl:
        "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=400&q=80",
      bikeUrl:
        "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?w=400&q=80",
    },
    update: {
      userId: riderUser.id,
      isActive: true,
      approvalStatus: "APPROVED",
      status: "AVAILABLE",
    },
  });

  await prisma.storeSettings.deleteMany();
  await prisma.storeSettings.create({
    data: {
      businessName: "MandiBazaar",
      phone: "042-111-MANDI",
      email: "hello@mandibazaar.com",
      address: "Lahore, Pakistan",
      currency: "PKR",
      deliveryRatePerKm: 10,
      defaultDeliveryFee: 100,
      freeDeliveryThreshold: 5000,
      minimumOrderAmount: 300,
      platformCommissionPct: 10,
      cityDeliveryFees: {},
      areaDeliveryFees: {},
      socialLinks: {},
      jazzCashSandbox: true,
    },
  });

  const store1 = await prisma.store.upsert({
    where: { slug: "fresh-mart-lahore" },
    create: {
      name: "Fresh Mart Lahore",
      slug: "fresh-mart-lahore",
      description: "Daily groceries and fresh produce",
      logoUrl:
        "https://images.unsplash.com/photo-1556740749-887f6717d7e4?w=200&q=80",
      status: "APPROVED",
      approvedAt: new Date(),
      reviewedById: admin.id,
      isVirtual: false,
      phone: "03005556677",
      email: "owner@freshmart.pk",
      addressLine: "Shop 4, Liberty Market",
      area: "Gulberg",
      city: "Lahore",
      province: "Punjab",
      latitude: 31.5102,
      longitude: 74.3441,
      googleMapsUrl: "https://maps.google.com/?q=31.5102,74.3441",
      cnicNumber: "35202-1234567-1",
      bankAccountTitle: "Imran Store Owner",
      bankName: "HBL",
      bankAccountNumber: "12345678901234",
      bankIban: "PK00HABB0000123456789012",
      jazzCashNumber: "03005556677",
      jazzCashAccountTitle: "Imran Store Owner",
      ownerId: storeOwner.id,
      members: { create: { userId: storeOwner.id, role: "OWNER" } },
      documents: {
        create: [
          {
            type: "CNIC_FRONT",
            url: "https://placehold.co/600x400?text=CNIC+Front",
          },
          {
            type: "CNIC_BACK",
            url: "https://placehold.co/600x400?text=CNIC+Back",
          },
          {
            type: "SHOP_IMAGE",
            url: "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=800&q=80",
          },
          {
            type: "ADDRESS_PROOF",
            url: "https://placehold.co/600x400?text=Address+Proof",
          },
        ],
      },
    },
    update: { status: "APPROVED", approvedAt: new Date() },
  });

  const store2Owner = await prisma.user.upsert({
    where: { phone: "03004445566" },
    create: {
      email: "owner@desikitchen.pk",
      phone: "03004445566",
      fullName: "Sana Kitchen",
      passwordHash: storeHash,
      roleId: storeOwnerRole.id,
      onboardingCompleted: true,
    },
    update: { onboardingCompleted: true },
  });

  const store2 = await prisma.store.upsert({
    where: { slug: "desi-kitchen-virtual" },
    create: {
      name: "Desi Kitchen (Virtual)",
      slug: "desi-kitchen-virtual",
      description: "Homemade pickles and spices — warehouse dispatch",
      logoUrl:
        "https://images.unsplash.com/photo-1506368249639-73a05d6f6488?w=200&q=80",
      status: "APPROVED",
      approvedAt: new Date(),
      reviewedById: admin.id,
      isVirtual: true,
      phone: "03004445566",
      addressLine: "Warehouse Unit 2, Sundar Industrial Estate",
      city: "Lahore",
      province: "Punjab",
      latitude: 31.2805,
      longitude: 74.1782,
      bankAccountTitle: "Sana Kitchen",
      bankName: "Meezan",
      jazzCashNumber: "03004445566",
      ownerId: store2Owner.id,
      members: { create: { userId: store2Owner.id, role: "OWNER" } },
      documents: {
        create: [
          { type: "CNIC_FRONT", url: "https://placehold.co/600x400?text=CNIC+F" },
          { type: "CNIC_BACK", url: "https://placehold.co/600x400?text=CNIC+B" },
          {
            type: "WAREHOUSE_IMAGE",
            url: "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?w=800&q=80",
          },
          {
            type: "ADDRESS_PROOF",
            url: "https://placehold.co/600x400?text=Warehouse+Address",
          },
        ],
      },
    },
    update: { status: "APPROVED" },
  });

  // Pending store for Super Admin to approve
  await prisma.store.upsert({
    where: { slug: "pending-corner-shop" },
    create: {
      name: "Corner Shop (Pending)",
      slug: "pending-corner-shop",
      status: "PENDING",
      addressLine: "Street 5, Johar Town",
      city: "Lahore",
      province: "Punjab",
      ownerId: storeOwner.id,
      documents: {
        create: [
          { type: "CNIC_FRONT", url: "https://placehold.co/400x300?text=CNIC+F" },
          { type: "CNIC_BACK", url: "https://placehold.co/400x300?text=CNIC+B" },
          { type: "SHOP_IMAGE", url: "https://placehold.co/400x300?text=Shop" },
          { type: "ADDRESS_PROOF", url: "https://placehold.co/400x300?text=Proof" },
        ],
      },
    },
    update: {},
  });

  const categoryData = [
    { name: "Vegetables", slug: "vegetables", sortOrder: 1 },
    { name: "Fruits", slug: "fruits", sortOrder: 2 },
    { name: "Dairy", slug: "dairy", sortOrder: 3 },
    { name: "Organic Grains", slug: "organic-grains", sortOrder: 4 },
    { name: "Honey", slug: "honey", sortOrder: 5 },
    { name: "Ghee", slug: "ghee", sortOrder: 6 },
    { name: "Pulses", slug: "pulses", sortOrder: 7 },
    { name: "Spices", slug: "spices", sortOrder: 8 },
    { name: "Grocery", slug: "grocery", sortOrder: 9 },
    { name: "Eggs", slug: "eggs", sortOrder: 10 },
    { name: "Pickles", slug: "pickles", sortOrder: 11 },
    { name: "Seasonal", slug: "seasonal", sortOrder: 12 },
  ];

  const categories: Record<string, string> = {};
  for (const c of categoryData) {
    const cat = await prisma.category.upsert({
      where: { slug: c.slug },
      create: {
        ...c,
        description: `Shop ${c.name.toLowerCase()} from MandiBazaar stores`,
        isActive: true,
        imageUrl: `https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80`,
      },
      update: { isActive: true },
    });
    categories[c.slug] = cat.id;
  }

  const products: Array<{
    storeId: string;
    name: string;
    slug: string;
    sku: string;
    category: string;
    price: number;
    salePrice?: number;
    unit: string;
    stock: number;
    featured?: boolean;
    best?: boolean;
    new?: boolean;
    seasonal?: boolean;
    short: string;
    tags: string[];
    image: string;
  }> = [
    // ——— Fresh Mart Lahore ———
    {
      storeId: store1.id,
      name: "Organic Tomato",
      slug: "organic-tomato",
      sku: "FM-VEG-001",
      category: "vegetables",
      price: 180,
      salePrice: 150,
      unit: "1kg",
      stock: 200,
      featured: true,
      short: "Juicy vine-ripened organic tomatoes.",
      tags: ["tomato", "vegetables"],
      image: "https://images.unsplash.com/photo-1546470427-e26264be0d16?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Spinach Bundle",
      slug: "spinach-bundle",
      sku: "FM-VEG-002",
      category: "vegetables",
      price: 80,
      unit: "500g",
      stock: 90,
      short: "Leafy spinach, morning harvest.",
      tags: ["spinach"],
      image: "https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Organic Carrots",
      slug: "organic-carrots",
      sku: "FM-VEG-003",
      category: "vegetables",
      price: 120,
      unit: "1kg",
      stock: 140,
      short: "Sweet crunchy organic carrots.",
      tags: ["carrot"],
      image: "https://images.unsplash.com/photo-1598170845058-32b9d6a5da37?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Cucumber",
      slug: "cucumber",
      sku: "FM-VEG-004",
      category: "vegetables",
      price: 90,
      unit: "1kg",
      stock: 100,
      short: "Crisp greenhouse cucumbers.",
      tags: ["cucumber"],
      image: "https://images.unsplash.com/photo-1449300079323-02e209d9d3a6?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Organic Potatoes",
      slug: "organic-potatoes",
      sku: "FM-VEG-005",
      category: "vegetables",
      price: 100,
      unit: "1kg",
      stock: 250,
      best: true,
      short: "Farm potatoes, sorted and cleaned.",
      tags: ["potato"],
      image: "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Onion (Red)",
      slug: "onion-red",
      sku: "FM-VEG-006",
      category: "vegetables",
      price: 110,
      salePrice: 95,
      unit: "1kg",
      stock: 180,
      short: "Fresh red onions for everyday cooking.",
      tags: ["onion"],
      image: "https://images.unsplash.com/photo-1518977956812-cd3d11e2f41e?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Capsicum Mix",
      slug: "capsicum-mix",
      sku: "FM-VEG-007",
      category: "vegetables",
      price: 220,
      unit: "500g",
      stock: 70,
      new: true,
      short: "Red, yellow & green capsicum mix.",
      tags: ["capsicum"],
      image: "https://images.unsplash.com/photo-1563565375-f3fdfdbefa83?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Fresh Milk",
      slug: "fresh-milk",
      sku: "FM-DAI-001",
      category: "dairy",
      price: 220,
      unit: "1 liter",
      stock: 100,
      best: true,
      featured: true,
      short: "Chilled farm milk.",
      tags: ["milk", "dairy"],
      image: "https://images.unsplash.com/photo-1563636619-e9143da7973b?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Farm Yogurt",
      slug: "farm-yogurt",
      sku: "FM-DAI-002",
      category: "dairy",
      price: 180,
      unit: "500g",
      stock: 55,
      new: true,
      short: "Set dahi from fresh farm milk.",
      tags: ["yogurt", "dahi"],
      image: "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Butter (Salted)",
      slug: "butter-salted",
      sku: "FM-DAI-003",
      category: "dairy",
      price: 450,
      salePrice: 399,
      unit: "200g",
      stock: 40,
      short: "Creamy salted butter.",
      tags: ["butter"],
      image: "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Farm Fresh Eggs",
      slug: "farm-fresh-eggs",
      sku: "FM-EGG-001",
      category: "eggs",
      price: 350,
      unit: "1 dozen",
      stock: 120,
      best: true,
      short: "Free-range eggs.",
      tags: ["eggs"],
      image: "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Desi Eggs (6-pack)",
      slug: "desi-eggs-6",
      sku: "FM-EGG-002",
      category: "eggs",
      price: 280,
      unit: "6 pcs",
      stock: 80,
      short: "Small-batch desi eggs.",
      tags: ["eggs", "desi"],
      image: "https://images.unsplash.com/photo-1498654077810-12c21d4d6dc3?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Basmati Rice",
      slug: "basmati-rice",
      sku: "FM-GRN-001",
      category: "organic-grains",
      price: 550,
      salePrice: 499,
      unit: "5kg",
      stock: 60,
      best: true,
      short: "Aged basmati rice.",
      tags: ["rice"],
      image: "https://images.unsplash.com/photo-1536304996689-27bd9b2560d0?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Organic Brown Rice",
      slug: "organic-brown-rice",
      sku: "FM-GRN-002",
      category: "organic-grains",
      price: 450,
      unit: "1kg",
      stock: 150,
      short: "Whole grain organic brown rice.",
      tags: ["rice", "organic"],
      image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Whole Wheat Flour",
      slug: "whole-wheat-flour",
      sku: "FM-GRN-003",
      category: "organic-grains",
      price: 180,
      salePrice: 160,
      unit: "2kg",
      stock: 200,
      best: true,
      short: "Stone-ground chakki atta.",
      tags: ["flour", "atta"],
      image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Moong Dal",
      slug: "moong-dal",
      sku: "FM-PUL-001",
      category: "pulses",
      price: 320,
      unit: "1kg",
      stock: 110,
      short: "Cleaned organic moong dal.",
      tags: ["dal"],
      image: "https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Masoor Dal",
      slug: "masoor-dal",
      sku: "FM-PUL-002",
      category: "pulses",
      price: 280,
      unit: "1kg",
      stock: 95,
      short: "Premium red lentils.",
      tags: ["dal", "lentils"],
      image: "https://images.unsplash.com/photo-1596797038530-2c107229654b?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Chana Dal",
      slug: "chana-dal",
      sku: "FM-PUL-003",
      category: "pulses",
      price: 260,
      unit: "1kg",
      stock: 100,
      short: "Yellow split chickpeas.",
      tags: ["dal", "chana"],
      image: "https://images.unsplash.com/photo-1585997073723-a4a5c0c0c0c0?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Bananas",
      slug: "bananas",
      sku: "FM-FRU-001",
      category: "fruits",
      price: 160,
      unit: "1 dozen",
      stock: 75,
      short: "Naturally ripened bananas.",
      tags: ["banana"],
      image: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Seasonal Mango",
      slug: "seasonal-mango",
      sku: "FM-FRU-002",
      category: "fruits",
      price: 400,
      salePrice: 350,
      unit: "1kg",
      stock: 60,
      seasonal: true,
      featured: true,
      short: "Chaunsa mangoes when in season.",
      tags: ["mango", "seasonal"],
      image: "https://images.unsplash.com/photo-1553279768-865429fa0078?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Apples (Kulu)",
      slug: "apples-kulu",
      sku: "FM-FRU-003",
      category: "fruits",
      price: 320,
      unit: "1kg",
      stock: 85,
      short: "Crisp Kulu apples.",
      tags: ["apple"],
      image: "https://images.unsplash.com/photo-1560806887-1e4cd0b6cbd6?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Mustard Oil",
      slug: "mustard-oil",
      sku: "FM-GRO-001",
      category: "grocery",
      price: 650,
      unit: "1 liter",
      stock: 45,
      short: "Cold-pressed sarson oil.",
      tags: ["oil"],
      image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Sugar (Fine)",
      slug: "sugar-fine",
      sku: "FM-GRO-002",
      category: "grocery",
      price: 190,
      unit: "1kg",
      stock: 200,
      short: "Refined white sugar.",
      tags: ["sugar"],
      image: "https://images.unsplash.com/photo-1587049352846-4a7b264b2811?w=800&q=80",
    },

    // ——— Desi Kitchen (Virtual) ———
    {
      storeId: store2.id,
      name: "Mixed Pickle",
      slug: "mixed-pickle",
      sku: "DK-PIC-001",
      category: "pickles",
      price: 450,
      salePrice: 399,
      unit: "500g",
      stock: 40,
      featured: true,
      short: "Homestyle mixed achar.",
      tags: ["pickle"],
      image: "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Mango Pickle",
      slug: "mango-pickle",
      sku: "DK-PIC-002",
      category: "pickles",
      price: 480,
      unit: "500g",
      stock: 35,
      seasonal: true,
      short: "Traditional aam ka achar.",
      tags: ["pickle", "mango"],
      image: "https://images.unsplash.com/photo-1601050690597-df0568f70950?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Lemon Pickle",
      slug: "lemon-pickle",
      sku: "DK-PIC-003",
      category: "pickles",
      price: 380,
      unit: "400g",
      stock: 50,
      short: "Tangy nimbu achar.",
      tags: ["pickle", "lemon"],
      image: "https://images.unsplash.com/photo-1599599810769-bcde5a160d32?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Red Chilli Powder",
      slug: "red-chilli-powder",
      sku: "DK-SPI-001",
      category: "spices",
      price: 250,
      unit: "250g",
      stock: 70,
      best: true,
      short: "Sun-dried chillies, freshly ground.",
      tags: ["spices"],
      image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Turmeric Powder",
      slug: "turmeric-powder",
      sku: "DK-SPI-002",
      category: "spices",
      price: 200,
      unit: "250g",
      stock: 85,
      short: "Pure haldi with natural colour.",
      tags: ["spices", "turmeric"],
      image: "https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Garam Masala",
      slug: "garam-masala",
      sku: "DK-SPI-003",
      category: "spices",
      price: 320,
      salePrice: 280,
      unit: "100g",
      stock: 60,
      featured: true,
      short: "House-blend garam masala.",
      tags: ["spices"],
      image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Cumin Seeds",
      slug: "cumin-seeds",
      sku: "DK-SPI-004",
      category: "spices",
      price: 180,
      unit: "200g",
      stock: 90,
      short: "Whole zeera, aromatic.",
      tags: ["spices", "cumin"],
      image: "https://images.unsplash.com/photo-1599909533730-8b4f4c0a0a0a?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Organic Honey",
      slug: "organic-honey",
      sku: "DK-HON-001",
      category: "honey",
      price: 1200,
      salePrice: 999,
      unit: "500g",
      stock: 80,
      featured: true,
      best: true,
      short: "Pure cold-extracted honey.",
      tags: ["honey"],
      image: "https://images.unsplash.com/photo-1587049352846-4a7b264b2811?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Sidr Honey",
      slug: "sidr-honey",
      sku: "DK-HON-002",
      category: "honey",
      price: 1800,
      unit: "500g",
      stock: 30,
      new: true,
      short: "Premium sidr honey.",
      tags: ["honey", "sidr"],
      image: "https://images.unsplash.com/photo-1558642452-9d2a7deb7f62?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Desi Ghee",
      slug: "desi-ghee",
      sku: "DK-GHE-001",
      category: "ghee",
      price: 2200,
      salePrice: 1999,
      unit: "1kg",
      stock: 50,
      featured: true,
      best: true,
      short: "Traditionally churned desi ghee.",
      tags: ["ghee", "dairy"],
      image: "https://images.unsplash.com/photo-1628088062854-d1870b455688?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Desi Ghee (500g)",
      slug: "desi-ghee-500",
      sku: "DK-GHE-002",
      category: "ghee",
      price: 1200,
      unit: "500g",
      stock: 40,
      short: "Small jar desi ghee.",
      tags: ["ghee"],
      image: "https://images.unsplash.com/photo-1628088062854-d1870b455688?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Handi Naan Mix",
      slug: "handi-naan-mix",
      sku: "DK-GRO-001",
      category: "grocery",
      price: 290,
      unit: "1kg",
      stock: 55,
      new: true,
      short: "Ready flour mix for soft naan.",
      tags: ["flour", "naan"],
      image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Roasted Gram",
      slug: "roasted-gram",
      sku: "DK-GRO-002",
      category: "grocery",
      price: 220,
      unit: "500g",
      stock: 70,
      short: "Crunchy bhuna chana.",
      tags: ["snack"],
      image: "https://images.unsplash.com/photo-1599599810894-b0ff0b0b0b0b?w=800&q=80",
    },
    // ——— Extra random / marketplace products ———
    {
      storeId: store1.id,
      name: "Basmati Rice Super Kernel 5kg",
      slug: "basmati-rice-5kg",
      sku: "FM-GRO-010",
      category: "grocery",
      price: 1899,
      salePrice: 1699,
      unit: "5kg",
      stock: 80,
      featured: true,
      best: true,
      short: "Premium long-grain basmati rice.",
      tags: ["rice", "grocery"],
      image: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Mineral Water 6x1.5L Pack",
      slug: "mineral-water-6pack",
      sku: "FM-GRO-011",
      category: "grocery",
      price: 480,
      salePrice: 420,
      unit: "pack",
      stock: 120,
      new: true,
      short: "Pure mineral water family pack.",
      tags: ["water", "beverage"],
      image: "https://images.unsplash.com/photo-1548839140-29a7492991bd?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Cooking Oil Canola 5L",
      slug: "cooking-oil-canola-5l",
      sku: "FM-GRO-012",
      category: "grocery",
      price: 2890,
      salePrice: 2599,
      unit: "5L",
      stock: 60,
      featured: true,
      short: "Heart-healthy canola cooking oil.",
      tags: ["oil", "grocery"],
      image: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Surf Excel 3kg",
      slug: "surf-excel-3kg",
      sku: "FM-GRO-013",
      category: "grocery",
      price: 1450,
      salePrice: 1299,
      unit: "3kg",
      stock: 90,
      best: true,
      short: "Stain removal washing powder.",
      tags: ["detergent", "household"],
      image: "https://images.unsplash.com/photo-1585421514284-efb74c2a69a0?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Fresh Chicken Breast 1kg",
      slug: "chicken-breast-1kg",
      sku: "FM-MEAT-001",
      category: "grocery",
      price: 650,
      salePrice: 599,
      unit: "1kg",
      stock: 30,
      new: true,
      short: "Halal fresh chicken breast.",
      tags: ["chicken", "meat"],
      image: "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Mango Chaunsa (1 dozen)",
      slug: "mango-chaunsa-dozen",
      sku: "FM-FRU-010",
      category: "fruits",
      price: 1200,
      salePrice: 999,
      unit: "dozen",
      stock: 40,
      seasonal: true,
      featured: true,
      short: "Sweet seasonal Chaunsa mangoes.",
      tags: ["mango", "fruits"],
      image: "https://images.unsplash.com/photo-1559182787-3235b51d25e0?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Red Bull Energy 4-Pack",
      slug: "red-bull-4pack",
      sku: "FM-BEV-001",
      category: "grocery",
      price: 880,
      salePrice: 799,
      unit: "pack",
      stock: 70,
      short: "Energy drink 4-can pack.",
      tags: ["energy", "drink"],
      image: "https://images.unsplash.com/photo-1554866585-cd94860890b7?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Lays Chips Family Pack",
      slug: "lays-chips-family",
      sku: "FM-SN-001",
      category: "grocery",
      price: 350,
      salePrice: 299,
      unit: "pack",
      stock: 180,
      best: true,
      short: "Classic salted potato chips.",
      tags: ["snacks", "chips"],
      image: "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Colgate Toothpaste 200g",
      slug: "colgate-toothpaste-200g",
      sku: "FM-HH-001",
      category: "grocery",
      price: 320,
      salePrice: 279,
      unit: "200g",
      stock: 110,
      new: true,
      short: "Max fresh cavity protection.",
      tags: ["toothpaste", "personal care"],
      image: "https://images.unsplash.com/photo-1622372738946-62e02505feb3?w=800&q=80",
    },
    {
      storeId: store1.id,
      name: "Frozen Fries 1kg",
      slug: "frozen-fries-1kg",
      sku: "FM-FRZ-001",
      category: "grocery",
      price: 450,
      salePrice: 399,
      unit: "1kg",
      stock: 65,
      short: "Crispy golden frozen fries.",
      tags: ["frozen", "fries"],
      image: "https://images.unsplash.com/photo-1573080496219-bb0808454c42?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Instant Noodles 5-Pack",
      slug: "instant-noodles-5pack",
      sku: "DK-GRO-010",
      category: "grocery",
      price: 350,
      salePrice: 299,
      unit: "pack",
      stock: 200,
      featured: true,
      new: true,
      short: "Quick masala instant noodles.",
      tags: ["noodles", "snack"],
      image: "https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Shan Biryani Masala 65g",
      slug: "shan-biryani-masala",
      sku: "DK-SPC-010",
      category: "spices",
      price: 85,
      salePrice: 72,
      unit: "65g",
      stock: 300,
      best: true,
      short: "Authentic biryani spice mix.",
      tags: ["masala", "biryani"],
      image: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Brown Bread Loaf",
      slug: "brown-bread-loaf",
      sku: "DK-BAK-001",
      category: "grocery",
      price: 180,
      unit: "loaf",
      stock: 45,
      new: true,
      short: "Freshly baked brown bread.",
      tags: ["bread", "bakery"],
      image: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Wireless Earbuds Pro",
      slug: "wireless-earbuds-pro",
      sku: "DK-TEC-001",
      category: "grocery",
      price: 3499,
      salePrice: 2799,
      unit: "piece",
      stock: 45,
      featured: true,
      best: true,
      short: "Noise-cancelling wireless earbuds.",
      tags: ["earbuds", "electronics"],
      image: "https://images.unsplash.com/photo-1598331668826-9e064a9f9f45?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Power Bank 20000mAh",
      slug: "power-bank-20000mah",
      sku: "DK-TEC-002",
      category: "grocery",
      price: 3999,
      salePrice: 3299,
      unit: "piece",
      stock: 25,
      featured: true,
      short: "Fast-charge portable power bank.",
      tags: ["powerbank", "electronics"],
      image: "https://images.unsplash.com/photo-1609091839311-d5365ef1d673?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Bluetooth Speaker Mini",
      slug: "bluetooth-speaker-mini",
      sku: "DK-TEC-003",
      category: "grocery",
      price: 2499,
      salePrice: 1999,
      unit: "piece",
      stock: 35,
      new: true,
      short: "Portable waterproof BT speaker.",
      tags: ["speaker", "bluetooth"],
      image: "https://images.unsplash.com/photo-1608043152269-423dbba4e7e3?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "USB-C Fast Charger 25W",
      slug: "usb-c-charger-25w",
      sku: "DK-TEC-004",
      category: "grocery",
      price: 1899,
      salePrice: 1499,
      unit: "piece",
      stock: 55,
      best: true,
      short: "Original fast wall charger.",
      tags: ["charger", "usb-c"],
      image: "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=800&q=80",
    },
    {
      storeId: store2.id,
      name: "Smart Watch Fitness Band",
      slug: "smart-watch-fitness",
      sku: "DK-TEC-005",
      category: "grocery",
      price: 5999,
      salePrice: 4499,
      unit: "piece",
      stock: 20,
      featured: true,
      seasonal: true,
      short: "Heart rate & step tracking smartwatch.",
      tags: ["smartwatch", "fitness"],
      image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=800&q=80",
    },
  ];

  for (const p of products) {
    const existing = await prisma.product.findFirst({
      where: { storeId: p.storeId, slug: p.slug },
    });
    if (existing) {
      await prisma.product.update({
        where: { id: existing.id },
        data: {
          price: p.price,
          salePrice: p.salePrice || null,
          stockQuantity: p.stock,
          status: "ACTIVE",
          isFeatured: Boolean(p.featured),
          isBestSeller: Boolean(p.best),
          isNewArrival: Boolean(p.new),
          isSeasonal: Boolean(p.seasonal),
        },
      });
      continue;
    }

    await prisma.product.create({
      data: {
        storeId: p.storeId,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        categoryId: categories[p.category],
        description: p.short,
        shortDescription: p.short,
        price: p.price,
        salePrice: p.salePrice || null,
        unit: p.unit,
        stockQuantity: p.stock,
        lowStockThreshold: 10,
        isFeatured: Boolean(p.featured),
        isBestSeller: Boolean(p.best),
        isNewArrival: Boolean(p.new),
        isSeasonal: Boolean(p.seasonal),
        tags: p.tags,
        status: "ACTIVE",
        images: {
          create: [{ url: p.image, alt: p.name, sortOrder: 0, isPrimary: true }],
        },
      },
    });
  }

  console.log(`Seeded ${products.length} products across 2 stores`);

  await prisma.coupon.upsert({
    where: { code: "FRESH10" },
    create: {
      code: "FRESH10",
      type: "PERCENTAGE",
      value: 10,
      minimumOrderAmount: 1000,
      maximumDiscount: 500,
      startDate: new Date("2026-01-01"),
      expiryDate: new Date("2027-12-31"),
      usageLimit: 1000,
      perUserLimit: 3,
      isActive: true,
    },
    update: { isActive: true },
  });

  await prisma.coupon.upsert({
    where: { code: "WELCOME200" },
    create: {
      code: "WELCOME200",
      type: "FIXED",
      value: 200,
      minimumOrderAmount: 1500,
      startDate: new Date("2026-01-01"),
      expiryDate: new Date("2027-12-31"),
      usageLimit: 500,
      perUserLimit: 1,
      isActive: true,
    },
    update: {},
  });

  // ——— Demo flows: customer + store owner + super admin ———
  const tomato = await prisma.product.findFirstOrThrow({
    where: { storeId: store1.id, slug: "organic-tomato" },
    include: { images: { take: 1 } },
  });
  const milk = await prisma.product.findFirstOrThrow({
    where: { storeId: store1.id, slug: "fresh-milk" },
    include: { images: { take: 1 } },
  });
  const honey = await prisma.product.findFirstOrThrow({
    where: { storeId: store2.id, slug: "organic-honey" },
    include: { images: { take: 1 } },
  });
  const pickle = await prisma.product.findFirstOrThrow({
    where: { storeId: store2.id, slug: "mixed-pickle" },
    include: { images: { take: 1 } },
  });
  const eggs = await prisma.product.findFirstOrThrow({
    where: { storeId: store1.id, slug: "farm-fresh-eggs" },
    include: { images: { take: 1 } },
  });

  const deliveryAddress = {
    label: "Home",
    fullName: "Ayesha Khan",
    phone: "03009876543",
    houseBuilding: "House 12, Block B",
    street: "Main Boulevard",
    area: "DHA Phase 5",
    city: "Lahore",
    province: "Punjab",
    latitude: 31.4697,
    longitude: 74.4087,
  };

  // Wipe previous demo orders (idempotent re-seed)
  await prisma.cashRemittance.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.cashCollection.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.delivery.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.storeFulfillment.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.paymentTransaction.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.payment.deleteMany({
    where: { order: { orderNumber: { startsWith: "DEMO-" } } },
  });
  await prisma.payout.deleteMany({
    where: { notes: { contains: "DEMO" } },
  });
  await prisma.order.deleteMany({
    where: { orderNumber: { startsWith: "DEMO-" } },
  });

  // Customer wishlist samples
  await prisma.wishlistItem.deleteMany({ where: { userId: customer.id } });
  await prisma.wishlistItem.createMany({
    data: [
      { userId: customer.id, productId: honey.id },
      { userId: customer.id, productId: tomato.id },
    ],
  });

  // 1) Multi-store order — CONFIRMED / packing (store owner sees fulfillments)
  const orderPacking = await prisma.order.create({
    data: {
      orderNumber: "DEMO-PACK-001",
      customerId: customer.id,
      subtotal: 150 + 220 + 999,
      discount: 0,
      deliveryFee: 120,
      deliveryDistanceKm: 12,
      grandTotal: 150 + 220 + 999 + 120,
      deliveryFeePaid: 120,
      productAmountPaid: 0,
      remainingAmount: 150 + 220 + 999,
      paymentMethod: "MIXED",
      deliveryFeePaymentStatus: "PAID",
      productPaymentStatus: "CASH_ON_DELIVERY",
      orderStatus: "PROCESSING",
      notes: "DEMO — multi-store packing",
      deliveryAddressSnapshot: deliveryAddress,
      estimatedDeliveryAt: new Date(Date.now() + 86400000),
      items: {
        create: [
          {
            storeId: store1.id,
            storeName: store1.name,
            productId: tomato.id,
            productName: tomato.name,
            sku: tomato.sku,
            unit: tomato.unit,
            quantity: 1,
            unitPrice: 150,
            finalPrice: 150,
            imageUrl: tomato.images[0]?.url,
          },
          {
            storeId: store1.id,
            storeName: store1.name,
            productId: milk.id,
            productName: milk.name,
            sku: milk.sku,
            unit: milk.unit,
            quantity: 1,
            unitPrice: 220,
            finalPrice: 220,
            imageUrl: milk.images[0]?.url,
          },
          {
            storeId: store2.id,
            storeName: store2.name,
            productId: honey.id,
            productName: honey.name,
            sku: honey.sku,
            unit: honey.unit,
            quantity: 1,
            unitPrice: 999,
            finalPrice: 999,
            imageUrl: honey.images[0]?.url,
          },
        ],
      },
      fulfillments: {
        create: [
          {
            storeId: store1.id,
            status: "PROCESSING",
            subtotal: 370,
            itemCount: 2,
            pickupAddress: {
              name: store1.name,
              addressLine: store1.addressLine,
              city: store1.city,
              latitude: store1.latitude,
              longitude: store1.longitude,
            },
          },
          {
            storeId: store2.id,
            status: "CONFIRMED",
            subtotal: 999,
            itemCount: 1,
            pickupAddress: {
              name: store2.name,
              addressLine: store2.addressLine,
              city: store2.city,
              latitude: store2.latitude,
              longitude: store2.longitude,
            },
          },
        ],
      },
    },
  });

  // 2) Ready for rider — Super Admin assigns rider
  const orderReady = await prisma.order.create({
    data: {
      orderNumber: "DEMO-RIDER-002",
      customerId: customer.id,
      subtotal: 399,
      discount: 0,
      deliveryFee: 100,
      deliveryDistanceKm: 8,
      grandTotal: 499,
      deliveryFeePaid: 100,
      productAmountPaid: 0,
      remainingAmount: 399,
      paymentMethod: "MIXED",
      deliveryFeePaymentStatus: "PAID",
      productPaymentStatus: "CASH_ON_DELIVERY",
      orderStatus: "READY_FOR_DISPATCH",
      notes: "DEMO — ready for rider assign",
      deliveryAddressSnapshot: deliveryAddress,
      items: {
        create: [
          {
            storeId: store2.id,
            storeName: store2.name,
            productId: pickle.id,
            productName: pickle.name,
            sku: pickle.sku,
            unit: pickle.unit,
            quantity: 1,
            unitPrice: 399,
            finalPrice: 399,
            imageUrl: pickle.images[0]?.url,
          },
        ],
      },
      fulfillments: {
        create: [
          {
            storeId: store2.id,
            status: "READY_FOR_DISPATCH",
            subtotal: 399,
            itemCount: 1,
            readyAt: new Date(),
            pickupAddress: {
              name: store2.name,
              addressLine: store2.addressLine,
              city: store2.city,
            },
          },
        ],
      },
    },
  });

  // 3) Out for delivery + COD — remittance PENDING for Super Admin
  const orderOut = await prisma.order.create({
    data: {
      orderNumber: "DEMO-COD-003",
      customerId: customer.id,
      subtotal: 350,
      discount: 0,
      deliveryFee: 80,
      deliveryDistanceKm: 6,
      grandTotal: 430,
      deliveryFeePaid: 80,
      productAmountPaid: 0,
      remainingAmount: 350,
      paymentMethod: "MIXED",
      deliveryFeePaymentStatus: "PAID",
      productPaymentStatus: "CASH_ON_DELIVERY",
      orderStatus: "OUT_FOR_DELIVERY",
      riderId: rider.id,
      notes: "DEMO — rider has COD, remit to Super Admin",
      deliveryAddressSnapshot: deliveryAddress,
      items: {
        create: [
          {
            storeId: store1.id,
            storeName: store1.name,
            productId: eggs.id,
            productName: eggs.name,
            sku: eggs.sku,
            unit: eggs.unit,
            quantity: 1,
            unitPrice: 350,
            finalPrice: 350,
            imageUrl: eggs.images[0]?.url,
          },
        ],
      },
      fulfillments: {
        create: [
          {
            storeId: store1.id,
            status: "OUT_FOR_DELIVERY",
            subtotal: 350,
            itemCount: 1,
            pickedUpAt: new Date(),
            pickupAddress: {
              name: store1.name,
              addressLine: store1.addressLine,
              city: store1.city,
            },
          },
        ],
      },
      delivery: {
        create: {
          riderId: rider.id,
          assignedAt: new Date(Date.now() - 3600000),
          pickedUpAt: new Date(Date.now() - 1800000),
        },
      },
      cashCollection: {
        create: {
          amountCollected: 350,
          riderId: rider.id,
          notes: "DEMO COD collected from customer",
        },
      },
      cashRemittance: {
        create: {
          riderId: rider.id,
          amount: 350,
          status: "PENDING",
          notes: "DEMO — Ali Rider must hand cash to Super Admin",
        },
      },
    },
  });

  // 4) Delivered this week — for weekly payout generation / store earnings
  const deliveredAt = new Date();
  deliveredAt.setDate(deliveredAt.getDate() - 2);
  const orderDelivered = await prisma.order.create({
    data: {
      orderNumber: "DEMO-DONE-004",
      customerId: customer.id,
      subtotal: 150 + 999,
      discount: 0,
      deliveryFee: 150,
      deliveryDistanceKm: 14,
      grandTotal: 150 + 999 + 150,
      deliveryFeePaid: 150,
      productAmountPaid: 150 + 999,
      remainingAmount: 0,
      paymentMethod: "MIXED",
      deliveryFeePaymentStatus: "PAID",
      productPaymentStatus: "PAID",
      orderStatus: "DELIVERED",
      riderId: rider.id,
      deliveredAt,
      notes: "DEMO — delivered, included in weekly payout",
      deliveryAddressSnapshot: deliveryAddress,
      createdAt: deliveredAt,
      items: {
        create: [
          {
            storeId: store1.id,
            storeName: store1.name,
            productId: tomato.id,
            productName: tomato.name,
            sku: tomato.sku,
            unit: tomato.unit,
            quantity: 1,
            unitPrice: 150,
            finalPrice: 150,
            imageUrl: tomato.images[0]?.url,
          },
          {
            storeId: store2.id,
            storeName: store2.name,
            productId: honey.id,
            productName: honey.name,
            sku: honey.sku,
            unit: honey.unit,
            quantity: 1,
            unitPrice: 999,
            finalPrice: 999,
            imageUrl: honey.images[0]?.url,
          },
        ],
      },
      fulfillments: {
        create: [
          {
            storeId: store1.id,
            status: "DELIVERED",
            subtotal: 150,
            itemCount: 1,
            pickupAddress: { name: store1.name, addressLine: store1.addressLine },
          },
          {
            storeId: store2.id,
            status: "DELIVERED",
            subtotal: 999,
            itemCount: 1,
            pickupAddress: { name: store2.name, addressLine: store2.addressLine },
          },
        ],
      },
      delivery: {
        create: {
          riderId: rider.id,
          assignedAt: deliveredAt,
          pickedUpAt: deliveredAt,
          deliveredAt,
        },
      },
      cashRemittance: {
        create: {
          riderId: rider.id,
          amount: 1149,
          status: "RECEIVED",
          receivedById: admin.id,
          receivedAt: deliveredAt,
          notes: "DEMO remittance already received",
        },
      },
    },
  });

  // Sample weekly payouts (pending) for store owners + one paid example
  const periodEnd = new Date();
  const periodStart = new Date();
  periodStart.setDate(periodStart.getDate() - 7);

  await prisma.payout.create({
    data: {
      storeId: store1.id,
      periodStart,
      periodEnd,
      grossSales: 150,
      commissionRate: 10,
      commissionAmount: 15,
      netAmount: 135,
      status: "PENDING",
      orderIds: [orderDelivered.id],
      notes: "DEMO payout Fresh Mart — mark paid from Super Admin",
      bankSnapshot: {
        bankName: store1.bankName,
        bankAccountTitle: store1.bankAccountTitle,
        jazzCashNumber: store1.jazzCashNumber,
      },
    },
  });

  await prisma.payout.create({
    data: {
      storeId: store2.id,
      periodStart,
      periodEnd,
      grossSales: 999,
      commissionRate: 10,
      commissionAmount: 100,
      netAmount: 899,
      status: "PENDING",
      orderIds: [orderDelivered.id],
      notes: "DEMO payout Desi Kitchen — mark paid from Super Admin",
      bankSnapshot: {
        jazzCashNumber: store2.jazzCashNumber,
        bankAccountTitle: store2.bankAccountTitle,
      },
    },
  });

  // Extra pending store for Super Admin approval queue
  await prisma.store.upsert({
    where: { slug: "demo-pending-bakery" },
    create: {
      name: "Sweet Crust Bakery (Pending)",
      slug: "demo-pending-bakery",
      status: "PENDING",
      description: "DEMO — approve this from Super Admin → Stores",
      addressLine: "Shop 9, MM Alam Road",
      city: "Lahore",
      province: "Punjab",
      ownerId: storeOwner.id,
      documents: {
        create: [
          { type: "CNIC_FRONT", url: "https://placehold.co/400x300?text=CNIC+Front" },
          { type: "CNIC_BACK", url: "https://placehold.co/400x300?text=CNIC+Back" },
          { type: "SHOP_IMAGE", url: "https://placehold.co/400x300?text=Bakery+Shop" },
          { type: "ADDRESS_PROOF", url: "https://placehold.co/400x300?text=Address" },
        ],
      },
    },
    update: { status: "PENDING" },
  });

  void orderPacking;
  void orderReady;
  void orderOut;

  console.log("\n========== MandiBazaar — DEMO READY ==========");
  console.log("\nCUSTOMER  →  03009876543 / Customer@123");
  console.log("  • Shop /products (35 items, 2 stores)");
  console.log("  • Wishlist has 2 items");
  console.log("  • Account → Orders: DEMO-PACK-001, DEMO-RIDER-002, DEMO-COD-003, DEMO-DONE-004");
  console.log("  • Coupons: FRESH10 | WELCOME200");
  console.log("\nSTORE OWNER  →  03005556677 / Store@12345  (/login?portal=store)");
  console.log("  • /store-portal → products, orders to pack, pending payouts");
  console.log("  • Fresh Mart + (owner of pending Corner Shop)");
  console.log("  • 2nd owner: 03004445566 / Store@12345 (Desi Kitchen)");
  console.log("\nSUPER ADMIN  →  admin@mandibazaar.com / Admin@12345  (/login?portal=admin)");
  console.log("  (legacy: admin@discountprice.com | admin@zulaal.com)");
  console.log("  • /admin/stores → PENDING: Corner Shop + Sweet Crust Bakery");
  console.log("  • /admin/orders → assign rider on DEMO-RIDER-002");
  console.log("  • /admin/payouts → PENDING remittance DEMO-COD-003 + store payouts");
  console.log("  • /admin/riders → Ali Rider");
  console.log("\nRIDER  →  03001112233 / Rider@12345  (/login?portal=rider)");
  console.log("  • /rider-portal → deliveries, COD collect, submit cash to Super Admin");
  console.log("  • Signup: /register/rider");
  console.log("=================================================\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
