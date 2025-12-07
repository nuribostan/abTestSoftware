import { KinesisStreamEvent } from "aws-lambda";
import { getPrismaClient } from "../shared/prisma";
import { IncomingEvent } from "../shared/types";

/**
 * Kinesis Data Streams consumer (Lambda)
 */
export const handler = async (event: KinesisStreamEvent): Promise<void> => {
  const db = getPrismaClient();

  console.log(`Processing ${event.Records.length} records`);

  for (const record of event.Records) {
    try {
      // Base64 decode
      const payload = Buffer.from(record.kinesis.data, "base64").toString("utf-8");

      // Event array veya tek event olabilir
      let events: IncomingEvent[];
      try {
        const parsed = JSON.parse(payload);
        events = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        console.error("Invalid JSON:", payload);
        continue;
      }

      // Her event'i işle (seri olarak - istersen paralel yap)
      for (const evt of events) {
        try {
          await processEvent(db, evt);
        } catch (err) {
          console.error("Event processing error:", err, evt);
        }
      }
    } catch (err) {
      console.error("Record processing error:", err);
    }
  }

  console.log(`Processed ${event.Records.length} records`);
};

/* ---------- Business logic ---------- */

async function processEvent(db: any, evt: IncomingEvent): Promise<void> {
  const { projectId, visitorId, eventType } = evt;

  if (!projectId || !visitorId || !eventType) {
    console.warn("Missing required fields:", { projectId, visitorId, eventType });
    return;
  }

  // 1. Visitor'ı bul veya oluştur
  let visitor;
  try {
    visitor = await upsertVisitor(db, evt);
  } catch (err) {
    console.error("upsertVisitor failed:", err, evt);
    return;
  }

  // 2. Event tipine göre işle
  switch (eventType) {
    case "SESSION_START":
      await handleSessionStart(db, visitor.id, evt);
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

/* ---------- Helpers (visitor / event handlers) ---------- */

async function upsertVisitor(db: any, evt: IncomingEvent) {
  const { projectId, visitorId, userAgent, referrer, url, timestamp, ip } = evt;

  const ua = userAgent || "";
  const deviceType = /Mobi|Android/i.test(ua) ? "mobile" :
                     /Tablet|iPad/i.test(ua) ? "tablet" : "desktop";
  const browser = detectBrowser(ua);
  const os = detectOS(ua);

  // UTM parametrelerini güvenli çıkar
  let utmSource: string | null = null, utmMedium: string | null = null, utmCampaign: string | null = null;
  try {
    if (url) {
      const parsedUrl = new URL(url);
      utmSource = parsedUrl.searchParams.get("utm_source");
      utmMedium = parsedUrl.searchParams.get("utm_medium");
      utmCampaign = parsedUrl.searchParams.get("utm_campaign");
    }
  } catch {}

  const time = timestamp ? new Date(timestamp) : new Date();

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
      firstSeen: time,
      lastSeen: time,
      visitCount: 1,
      pageViews: 1,
      ipAddress: ip || null,
    },
    update: {
      lastSeen: time,
      pageViews: { increment: 1 },
      userAgent: ua || undefined,
      ipAddress: ip || undefined,
    },
  });
}

async function handleSessionStart(db: any, visitorDbId: string, evt: IncomingEvent) {
  try {
    await db.visitor.update({
      where: { id: visitorDbId },
      data: { visitCount: { increment: 1 } },
    });

    await db.event.create({
      data: {
        projectId: evt.projectId,
        visitorId: visitorDbId,
        eventType: "PAGE_VIEW",
        pageUrl: evt.url || null,
        eventData: {
          sessionId: evt.sessionId,
          referrer: evt.referrer,
          isSessionStart: true,
        },
      },
    });
  } catch (err) {
    console.error("handleSessionStart error:", err, evt);
  }
}

async function handleExperimentView(db: any, visitorDbId: string, evt: IncomingEvent) {
  const { projectId, experimentId, variantId } = evt;
  if (!experimentId || !variantId) return;

  try {
    const existingAssignment = await db.variantAssignment.findUnique({
      where: {
        visitorId_experimentId: {
          visitorId: visitorDbId,
          experimentId,
        },
      },
    });

    if (!existingAssignment) {
      await db.variantAssignment.create({
        data: {
          visitorId: visitorDbId,
          experimentId,
          variantId,
        },
      });

      await db.variant.update({
        where: { id: variantId },
        data: { visitors: { increment: 1 } },
      });

      await db.experiment.update({
        where: { id: experimentId },
        data: { totalVisitors: { increment: 1 } },
      });

      await updateDailyStat(db, experimentId, "impressions");
    }

    await db.event.create({
      data: {
        projectId,
        visitorId: visitorDbId,
        experimentId,
        variantId,
        eventType: "EXPERIMENT_VIEW",
        pageUrl: evt.url || null,
      },
    });

    await db.liveLog.create({
      data: {
        experimentId,
        visitorId: evt.visitorId,
        variantId,
        logType: "VISITOR_ASSIGNED",
        message: `Visitor assigned to ${evt.variantName || variantId}`,
        details: {
          isControl: !!evt.isControl,
          url: evt.url,
        },
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  } catch (err) {
    console.error("handleExperimentView error:", err, evt);
  }
}

async function handleGoalConversion(db: any, visitorDbId: string, evt: IncomingEvent) {
  const { projectId, goalId, attributedExperiments, value, currency } = evt;
  if (!goalId || !attributedExperiments || attributedExperiments.length === 0) {
    return;
  }

  for (const exp of attributedExperiments) {
    try {
      const { experimentId, variantId } = exp;

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

      await db.variant.update({
        where: { id: variantId },
        data: { conversions: { increment: 1 } },
      });

      await db.experiment.update({
        where: { id: experimentId },
        data: { totalConversions: { increment: 1 } },
      });

      await db.experimentGoal.updateMany({
        where: { experimentId, goalId },
        data: { conversions: { increment: 1 } },
      });

      await updateDailyStat(db, experimentId, "conversions", value);

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
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
    } catch (err) {
      console.error("handleGoalConversion inner error:", err, exp);
    }
  }
}

async function handleCustomEvent(db: any, visitorDbId: string, evt: IncomingEvent) {
  try {
    await db.event.create({
      data: {
        projectId: evt.projectId,
        visitorId: visitorDbId,
        experimentId: evt.attributedExperiments?.[0]?.experimentId || null,
        variantId: evt.attributedExperiments?.[0]?.variantId || null,
        eventType: "CUSTOM",
        eventName: evt.eventName || null,
        pageUrl: evt.url || null,
        eventData: evt,
      },
    });
  } catch (err) {
    console.error("handleCustomEvent error:", err, evt);
  }
}

async function handleGenericEvent(db: any, visitorDbId: string, evt: IncomingEvent) {
  try {
    await db.event.create({
      data: {
        projectId: evt.projectId,
        visitorId: visitorDbId,
        eventType: evt.eventType as any,
        pageUrl: evt.url || null,
        eventData: evt,
      },
    });
  } catch (err) {
    console.error("handleGenericEvent error:", err, evt);
  }
}

/* ---------- Utilities ---------- */

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
        conversions: field === "conversions" ? 1 : 0,
        revenue: revenue || 0,
      },
      update: {
        [field]: { increment: 1 },
        ...(revenue && field === "conversions" ? { revenue: { increment: revenue } } : {}),
      },
    });
  } catch (err) {
    console.error("Daily stat update error:", err, experimentId, field);
  }
}

function detectBrowser(ua: string): string {
  if (!ua) return "other";
  if (ua.includes("Chrome") && !ua.includes("Edg")) return "chrome";
  if (ua.includes("Firefox")) return "firefox";
  if (ua.includes("Safari") && !ua.includes("Chrome")) return "safari";
  if (ua.includes("Edg")) return "edge";
  if (ua.includes("Opera") || ua.includes("OPR")) return "opera";
  return "other";
}

function detectOS(ua: string): string {
  if (!ua) return "other";
  if (ua.includes("Windows")) return "windows";
  if (ua.includes("Mac OS")) return "mac";
  if (ua.includes("Linux") && !ua.includes("Android")) return "linux";
  if (ua.includes("Android")) return "android";
  if (ua.includes("iPhone") || ua.includes("iPad") || ua.includes("iOS")) return "ios";
  return "other";
}
