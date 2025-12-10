import { PrismaClient } from "./client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Test User oluştur
  const user = await prisma.user.upsert({
    where: { email: "test@example.com" },
    update: {},
    create: {
      email: "test@example.com",
      password: "test123", // Gerçek uygulamada hash'le
      name: "Test User",
      company: "Test Company",
      plan: "PRO",
      isActive: true,
      emailVerified: true,
    },
  });
  console.log("✅ User created:", user.email);

  // 2. Test Project oluştur
  const project = await prisma.project.upsert({
    where: { domain: "localhost" },
    update: {},
    create: {
      userId: user.id,
      name: "Test Website",
      domain: "localhost",
      isActive: true,
      timezone: "Europe/Istanbul",
    },
  });
  console.log("✅ Project created:", project.name);
  console.log("   📌 API Key:", project.apiKey);
  console.log("   📌 Tracking Code:", project.trackingCode);

  // 3.  Test Experiment oluştur (idempotent)
  const experiment = await prisma.experiment.upsert({
    where: { name_projectId: { name: "Homepage Hero Test", projectId: project.id } },
    update: {},
    create: {
      projectId: project.id,
      name: "Homepage Hero Test",
      url: "http://localhost",
      type: "AB",
      status: "RUNNING",
      trafficAllocation: 100,
      startDate: new Date(),
    },
  });
  console.log("✅ Experiment created:", experiment.name);

  // 4.  Location (URL targeting) oluştur - upsert ile idempotent yap
  await prisma.location.upsert({
    where: { projectId_name: { projectId: project.id, name: "All Pages" } },
    update: {},
    create: {
      projectId: project.id,
      experimentId: experiment.id,
      name: "All Pages",
      type: "URL",
      matchType: "CONTAINS",
      value: "/",
    },
  });
  console.log("✅ Location created");

  // 5. Control Variant oluştur (upsert ile idempotent)
  await prisma.variant.upsert({
    where: { experimentId_name: { experimentId: experiment.id, name: "Control" } },
    update: {},
    create: {
      experimentId: experiment.id,
      name: "Control",
      description: "Original version",
      isControl: true,
      trafficWeight: 50,
      changes: [],
    },
  });
  console.log("✅ Control variant created: Control");

  // 6. Test Variant oluştur (upsert)
  await prisma.variant.upsert({
    where: { experimentId_name: { experimentId: experiment.id, name: "Variant A" } },
    update: {},
    create: {
      experimentId: experiment.id,
      name: "Variant A",
      description: "New design",
      isControl: false,
      trafficWeight: 50,
      changes: [
        {
          selector: "h1",
          action: "setText",
          value: "🚀 Yeni Tasarım! ",
        },
        {
          selector: ". cta-button",
          action: "setStyle",
          value: "background-color: #10b981; color: white;",
        },
      ],
    },
  });
  console.log("✅ Test variant created: Variant A");

  // 7. Click Goal oluştur -> upsert (unique constraint'ten kaçınmak için)
  const clickGoal = await prisma.goal.upsert({
    where: { projectId_name: { projectId: project.id, name: "CTA Button Click" } },
    update: {},
    create: {
      projectId: project.id,
      name: "CTA Button Click",
      description: "User clicks the CTA button",
      type: "CLICK",
      selector: ". cta-button",
      isActive: true,
    },
  });
  console.log("✅ Click goal created or existing:", clickGoal.name);

  // 8. Purchase Goal oluştur -> upsert
  const purchaseGoal = await prisma.goal.upsert({
    where: { projectId_name: { projectId: project.id, name: "Purchase" } },
    update: {},
    create: {
      projectId: project.id,
      name: "Purchase",
      description: "User completes purchase",
      type: "CUSTOM_EVENT",
      eventName: "purchase",
      revenueTracking: true,
      isActive: true,
    },
  });
  console.log("✅ Purchase goal created or existing:", purchaseGoal.name);

  // 9. Goals'ları Experiment'a bağla (upsert)
  await prisma.experimentGoal.upsert({
    where: { experimentId_goalId: { experimentId: experiment.id, goalId: clickGoal.id } },
    update: {},
    create: {
      experimentId: experiment.id,
      goalId: clickGoal.id,
      isPrimary: true,
    },
  });

  await prisma.experimentGoal.upsert({
    where: { experimentId_goalId: { experimentId: experiment.id, goalId: purchaseGoal.id } },
    update: {},
    create: {
      experimentId: experiment.id,
      goalId: purchaseGoal.id,
      isPrimary: false,
    },
  });
  console.log("✅ Goals linked to experiment");

  console.log("\n" + "=".repeat(50));
  console.log("🎉 SEEDING TAMAMLANDI!");
  console.log("=".repeat(50));
  console.log("\n📋 ÖNEMLİ BİLGİLER (BUNLARI KAYDET!):\n");
  console.log("Project ID:     ", project.id);
  console.log("API Key:        ", project.apiKey);
  console.log("Tracking Code:  ", project.trackingCode);
  console.log("Experiment ID:  ", experiment.id);
  console.log("\n" + "=".repeat(50));
}

main()
  .catch((e) => {
    console.error("❌ Seed error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
