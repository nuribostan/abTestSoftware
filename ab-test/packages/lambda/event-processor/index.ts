import { FirehoseTransformationEvent, FirehoseTransformationResult } from "aws-lambda";
import { getPrismaClient } from "../shared/prisma";
import { IncomingEvent, EventType } from "../shared/types";

/**
 * Event Processor Lambda
 * 
 * Kinesis Firehose'dan gelen event batch'lerini işler.
 * 
 * İşlem adımları:
 * 1. Event'leri decode et
 * 2. Her event için:
 *    - Visitor kaydı oluştur/güncelle
 *    - Event tipine göre işle
 *    - İstatistikleri güncelle
 * 3. İşlenmiş event'leri S3'e yaz
 */
export const handler = async (
  event: FirehoseTransformationEvent
): Promise<FirehoseTransformationResult> => {
  const db = getPrismaClient();
  const output: FirehoseTransformationResult["records"] = [];

  console.log(`Processing ${event.records.length} records`);

  for (const record of event.records) {
    try {
      // Base64 decode
      const payload = Buffer.from(record. data, "base64").toString("utf-8");
      
      // Event array veya tek event olabilir
      let events: IncomingEvent[];
      try {
        const parsed = JSON.parse(payload);
        events = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        console.error("Invalid JSON:", payload);
        output.push({
          recordId: record. recordId,
          result: "ProcessingFailed",
          data: record.data,
        });
        continue;
      }

      // Her event'i işle
      for (const evt of events) {
        try {
          await processEvent(db, evt);
        } catch (err) {
          console. error("Event processing error:", err, evt);
        }
      }

      // Başarılı - S3'e yaz
      output.push({
        recordId: record.recordId,
        result: "Ok",
        data: record.data,
      });

    } catch (err) {
      console.error("Record processing error:", err);
      output.push({
        recordId: record.recordId,
        result: "ProcessingFailed",
        data: record.data,
      });
    }
  }

  console.log(`Processed ${output.length} records`);
  return { records: output };
};

/**
 * Tek bir event'i işler
 */
async function processEvent(db: any, evt: IncomingEvent): Promise<void> {
  const { projectId, visitorId, eventType } = evt;

  if (! projectId || !visitorId || !eventType) {
    console.warn("Missing required fields:", { projectId, visitorId, eventType });
    return;
  }

  // 1. Visitor'ı bul veya oluştur
  const visitor = await upsertVisitor(db, evt);

  // 2. Event tipine göre işle
  switch (eventType) {
    case "SESSION_START":
      await handleSessionStart(db, visitor. id, evt);
      break;

    case "EXPERIMENT_VIEW":
      await handleExperimentView(db, visitor.id, evt);
      break;

    case "GOAL_CONVERSION":
      await handleGoalConversion(db, visitor.id, evt);
      break;

    case "CUSTOM_EVENT":
      await handleCustomEvent(db, visitor.id, evt);
      break;

    default:
      await handleGenericEvent(db, visitor.id, evt);
  }
}

/**
 * Visitor kaydını oluşturur veya günceller
 */
async function upsertVisitor(db: any, evt: IncomingEvent) {
  const { projectId, visitorId, userAgent, referrer } = evt;

  // User-Agent'tan cihaz bilgisi çıkar
  const ua = userAgent || "";
  const deviceType = /Mobi|Android/i.test(ua) ? "mobile" : 
                     /Tablet|iPad/i.test(ua) ? "tablet" : "desktop";
  const browser = detectBrowser(ua);
  const os = detectOS(ua);

  // UTM parametrelerini çıkar
  let utmSource, utmMedium, utmCampaign;
  try {
    const url = new URL(evt.url);
    utmSource = url.searchParams.get("utm_source");
    utmMedium = url.searchParams.get("utm_medium");
    utmCampaign = url.searchParams.get("utm_campaign");
  } catch {}

  return db.visitor.upsert({
    where: {
      projectId_visitorId: {
        projectId,
        visitorId,
      },
    },
    create: {
      projectId,
      visitorId,
      userAgent: ua,
      deviceType,
      browser,
      os,
      referrer,
      utmSource,
      utmMedium,
      utmCampaign,
      firstSeen: new Date(evt.timestamp),
      lastSeen: new Date(evt.timestamp),
      visitCount: 1,
      pageViews: 1,
    },
    update: {
      lastSeen: new Date(evt.timestamp),
      pageViews: { increment: 1 },
    },
  });
}

/**
 * Session start event'ini işler
 */
async function handleSessionStart(db: any, visitorDbId: string, evt: IncomingEvent) {
  // Visit count artır
  await db. visitor.update({
    where: { id: visitorDbId },
    data: { visitCount: { increment: 1 } },
  });

  // Event kaydet
  await db. event.create({
    data: {
      projectId: evt.projectId,
      visitorId: visitorDbId,
      eventType: "PAGE_VIEW",
      pageUrl: evt.url,
      eventData: {
        sessionId: evt.sessionId,
        referrer: evt.referrer,
        isSessionStart: true,
      },
    },
  });
}

/**
 * Experiment view event'ini işler
 */
async function handleExperimentView(db: any, visitorDbId: string, evt: IncomingEvent) {
  const { projectId, experimentId, variantId } = evt;

  if (!experimentId || !variantId) return;

  // 1. Variant Assignment kaydet (upsert)
  const existingAssignment = await db. variantAssignment.findUnique({
    where: {
      visitorId_experimentId: {
        visitorId: visitorDbId,
        experimentId,
      },
    },
  });

  if (! existingAssignment) {
    // Yeni atama
    await db.variantAssignment.create({
      data: {
        visitorId: visitorDbId,
        experimentId,
        variantId,
      },
    });

    // Variant visitor sayısını artır
    await db.variant.update({
      where: { id: variantId },
      data: { visitors: { increment: 1 } },
    });

    // Experiment visitor sayısını artır
    await db.experiment.update({
      where: { id: experimentId },
      data: { totalVisitors: { increment: 1 } },
    });

    // Daily stat güncelle
    await updateDailyStat(db, experimentId, "impressions");
  }

  // 2. Event kaydet
  await db.event.create({
    data: {
      projectId,
      visitorId: visitorDbId,
      experimentId,
      variantId,
      eventType: "EXPERIMENT_VIEW",
      pageUrl: evt.url,
    },
  });

  // 3.  Live log kaydet
  await db.liveLog.create({
    data: {
      experimentId,
      visitorId: evt.visitorId,
      variantId,
      logType: "VISITOR_ASSIGNED",
      message: `Visitor assigned to ${evt.variantName || variantId}`,
      details: {
        isControl: evt.isControl,
        url: evt.url,
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

/**
 * Goal conversion event'ini işler
 */
async function handleGoalConversion(db: any, visitorDbId: string, evt: IncomingEvent) {
  const { projectId, goalId, attributedExperiments, value, currency } = evt;

  if (!goalId || !attributedExperiments || attributedExperiments. length === 0) {
    return;
  }

  // Her attributed experiment için conversion kaydet
  for (const exp of attributedExperiments) {
    const { experimentId, variantId } = exp;

    // 1. GoalConversion kaydet
    await db.goalConversion.create({
      data: {
        goalId,
        experimentId,
        variantId,
        visitorId: visitorDbId,
        value: value || null,
        currency: currency || "TRY",
        conversionData: {
          url: evt.url,
          timestamp: evt.timestamp,
          goalType: evt.goalType,
        },
      },
    });

    // 2.  Variant conversion sayısını artır
    await db.variant.update({
      where: { id: variantId },
      data: { conversions: { increment: 1 } },
    });

    // 3.  Experiment conversion sayısını artır
    await db.experiment.update({
      where: { id: experimentId },
      data: { totalConversions: { increment: 1 } },
    });

    // 4.  ExperimentGoal istatistiklerini güncelle
    await db.experimentGoal. updateMany({
      where: { experimentId, goalId },
      data: { conversions: { increment: 1 } },
    });

    // 5.  Daily stat güncelle
    await updateDailyStat(db, experimentId, "conversions", value);

    // 6.  Live log kaydet
    await db.liveLog.create({
      data: {
        experimentId,
        visitorId: evt.visitorId,
        variantId,
        logType: "GOAL_CONVERSION",
        message: `Goal "${evt.goalName || goalId}" converted`,
        details: {
          goalType: evt.goalType,
          value,
          url: evt.url,
        },
        expiresAt: new Date(Date. now() + 24 * 60 * 60 * 1000),
      },
    });
  }
}

/**
 * Custom event'i işler
 */
async function handleCustomEvent(db: any, visitorDbId: string, evt: IncomingEvent) {
  await db.event.create({
    data: {
      projectId: evt. projectId,
      visitorId: visitorDbId,
      experimentId: evt.attributedExperiments?.[0]?.experimentId,
      variantId: evt. attributedExperiments?.[0]?. variantId,
      eventType: "CUSTOM",
      eventName: evt.eventName,
      pageUrl: evt.url,
      eventData: evt,
    },
  });
}

/**
 * Diğer event tiplerini işler
 */
async function handleGenericEvent(db: any, visitorDbId: string, evt: IncomingEvent) {
  await db.event.create({
    data: {
      projectId: evt.projectId,
      visitorId: visitorDbId,
      eventType: evt.eventType as any,
      pageUrl: evt.url,
      eventData: evt,
    },
  });
}

/**
 * Günlük istatistikleri günceller
 */
async function updateDailyStat(
  db: any,
  experimentId: string,
  field: "impressions" | "conversions",
  revenue?: number
) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  try {
    await db.experimentDailyStat.upsert({
      where: {
        experimentId_date: {
          experimentId,
          date: today,
        },
      },
      create: {
        experimentId,
        date: today,
        impressions: field === "impressions" ? 1 : 0,
        conversions: field === "conversions" ?  1 : 0,
        revenue: revenue || 0,
      },
      update: {
        [field]: { increment: 1 },
        ...(revenue && field === "conversions" ? { revenue: { increment: revenue } } : {}),
      },
    });
  } catch (err) {
    console.error("Daily stat update error:", err);
  }
}

/**
 * User-Agent'tan browser tespit eder
 */
function detectBrowser(ua: string): string {
  if (ua.includes("Chrome") && ! ua.includes("Edg")) return "chrome";
  if (ua.includes("Firefox")) return "firefox";
  if (ua. includes("Safari") && !ua.includes("Chrome")) return "safari";
  if (ua.includes("Edg")) return "edge";
  if (ua.includes("Opera") || ua.includes("OPR")) return "opera";
  return "other";
}

/**
 * User-Agent'tan OS tespit eder
 */
function detectOS(ua: string): string {
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac OS")) return "mac";
  if (ua. includes("Linux") && !ua.includes("Android")) return "linux";
  if (ua.includes("Android")) return "android";
  if (ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iOS")) return "ios";
  return "other";
}