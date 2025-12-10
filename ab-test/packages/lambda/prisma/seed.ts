import { PrismaClient } from "./client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Test User oluştur / varsa al
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
  console.log("✅ User created:", user. email);

  // 2. Test Project oluştur / varsa al (domain unique)
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
  console.log("✅ Project created:", project. name);
  console.log("   📌 API Key:", project.apiKey);
  console.log("   📌 Tracking Code:", project.trackingCode);

  // 3. Experiment - önce var mı kontrol et, yoksa oluştur
  let experiment = await prisma.experiment. findFirst({
    where: { projectId: project.id, name: "Homepage Hero Test" },
  });
  if (!experiment) {
    experiment = await prisma. experiment.create({
      data: {
        projectId: project. id,
        name: "Homepage Hero Test",
        url: "http://localhost",
        type: "AB",
        status: "RUNNING",
        trafficAllocation: 100,
        startDate: new Date(),
      },
    });
  }
  console.log("✅ Experiment created or existing:", experiment.name);

  // 4. Location (URL targeting) - önce kontrol et, yoksa oluştur
  let location = await prisma.location. findFirst({
    where: { projectId: project.id, name: "All Pages" },
  });
  if (!location) {
    location = await prisma. location.create({
      data: {
        projectId: project. id,
        experimentId: experiment.id,
        name: "All Pages",
        type: "URL",
        matchType: "CONTAINS",
        value: "/",
      },
    });
  }
  console.log("✅ Location created or existing");

  // 5. Control Variant - önce kontrol et, yoksa oluştur (Variant @@unique([experimentId, name]))
  let controlVariant = await prisma. variant.findFirst({
    where: { experimentId: experiment.id, name: "Control" },
  });
  if (!controlVariant) {
    controlVariant = await prisma.variant.create({
      data: {
        experimentId: experiment.id,
        name: "Control",
        description: "Original version",
        isControl: true,
        trafficWeight: 50,
        changes: [],
      },
    });
  }
  console.log("✅ Control variant created or existing:", controlVariant.name);

  // 6. Test Variant - önce kontrol et, yoksa oluştur
  let testVariant = await prisma.variant.findFirst({
    where: { experimentId: experiment.id, name: "Variant A" },
  });
  if (!testVariant) {
    testVariant = await prisma.variant. create({
      data: {
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
  }
  console.log("✅ Test variant created or existing:", testVariant.name);

  // 7. Click Goal - önce kontrol et, yoksa oluştur (Goal @@unique([projectId, name]))
  let clickGoal = await prisma.goal.findFirst({
    where: { projectId: project.id, name: "CTA Button Click" },
  });
  if (!clickGoal) {
    clickGoal = await prisma.goal.create({
      data: {
        projectId: project.id,
        name: "CTA Button Click",
        description: "User clicks the CTA button",
        type: "CLICK",
        selector: ".cta-button",
        isActive: true,
      },
    });
  }
  console.log("✅ Click goal created or existing:", clickGoal.name);

  // 8. Purchase Goal - önce kontrol et, yoksa oluştur
  let purchaseGoal = await prisma.goal.findFirst({
    where: { projectId:  project.id, name: "Purchase" },
  });
  if (!purchaseGoal) {
    purchaseGoal = await prisma.goal.create({
      data: {
        projectId:  project.id,
        name: "Purchase",
        description: "User completes purchase",
        type: "CUSTOM_EVENT",
        eventName: "purchase",
        revenueTracking: true,
        isActive: true,
      },
    });
  }
  console.log("✅ Purchase goal created or existing:", purchaseGoal.name);

  // 9. Goals'ları Experiment'a bağla (ExperimentGoal @@unique([experimentId, goalId]))
  const existingExpGoal1 = await prisma.experimentGoal.findFirst({
    where: { experimentId: experiment.id, goalId: clickGoal. id },
  });
  if (!existingExpGoal1) {
    await prisma.experimentGoal.create({
      data: {
        experimentId: experiment.id,
        goalId: clickGoal.id,
        isPrimary: true,
      },
    });
  }

  const existingExpGoal2 = await prisma.experimentGoal.findFirst({
    where: { experimentId: experiment.id, goalId: purchaseGoal.id },
  });
  if (!existingExpGoal2) {
    await prisma. experimentGoal.create({
      data: {
        experimentId:  experiment.id,
        goalId: purchaseGoal.id,
        isPrimary: false,
      },
    });
  }
  console.log("✅ Goals linked to experiment");

  console.log("\n" + "=".repeat(50));
  console.log("🎉 SEEDING TAMAMLANDI!");
  console.log("=".repeat(50));
  console.log("\n📋 ÖNEMLİ BİLGİLER (BUNLARI KAYDET!):\n");
  console.log("Project ID:     ", project.id);
  console.log("API Key:        ", project.apiKey);
  console.log("Tracking Code:  ", project.trackingCode);
  console.log("Experiment ID:  ", experiment.id);
  console.log("Control ID:      ", controlVariant.id);
  console.log("Variant A ID:   ", testVariant.id);
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
