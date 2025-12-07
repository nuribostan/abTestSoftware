import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { getPrismaClient } from "../shared/prisma";
import {
  success,
  successWithCache,
  notFound,
  badRequest,
  error,
  cors,
} from "../shared/response";
import {
  SDKConfig,
  SDKExperiment,
  SDKGoal,
  SDKAudience,
} from "../shared/types";

/**
 * Config Handler Lambda
 *
 * SDK bu endpoint'i çağırarak aktif test config'lerini alır.
 *
 * Endpoint: GET /config/{projectId}
 *
 * projectId parametresi şunlardan biri olabilir:
 * - Project UUID
 * - Project API Key
 * - Project Tracking Code
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return cors();
  }

  try {
    const projectId = event.pathParameters?.projectId;

    if (!projectId) {
      return badRequest("Project ID is required");
    }

    const db = getPrismaClient();

    // 1. Project'i bul
    const project = await db.project.findFirst({
      where: {
        OR: [
          { id: projectId },
          { apiKey: projectId },
          { trackingCode: projectId },
        ],
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        domain: true,
        globalJS: true,
      },
    });

    if (!project) {
      return notFound("Project not found or inactive");
    }

    // 2.  Aktif experiment'ları getir
    const experiments = await db.experiment.findMany({
      where: {
        projectId: project.id,
        status: "RUNNING",
        isArchived: false,
      },
      select: {
        id: true,
        name: true,
        type: true,
        trafficAllocation: true,
        locations: {
          select: {
            type: true,
            matchType: true,
            value: true,
          },
        },
        audiences: {
          select: {
            type: true,
            condition: true,
            operator: true,
            value: true,
          },
        },
        variants: {
          select: {
            id: true,
            name: true,
            isControl: true,
            trafficWeight: true,
            changes: true,
          },
          orderBy: {
            isControl: "desc", // Control variant önce
          },
        },
      },
    });

    // 3. Aktif goal'ları getir
    const goals = await db.goal.findMany({
      where: {
        projectId: project.id,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        type: true,
        urlPattern: true,
        selector: true,
        eventName: true,
        revenueTracking: true,
        experimentGoals: {
          select: {
            experimentId: true,
          },
        },
      },
    });

    // 4. SDK formatına dönüştür
    const config: SDKConfig = {
      projectId: project.id,
      version: Date.now(),
      experiments: experiments.map(
        //@ts-ignore
        (exp): SDKExperiment => ({
          id: exp.id,
          name: exp.name,
          type: exp.type,
          status: "RUNNING",
          trafficAllocation: exp.trafficAllocation,
          urlPattern: buildUrlPattern(exp.locations),
          audiences: exp.audiences.map(
            //@ts-ignore
            (aud): SDKAudience => ({
              type: mapAudienceType(aud.type),
              operator: aud.operator,
              value: aud.value,
              condition: aud.condition,
            })
          ),
          //@ts-ignore
          variants: exp.variants.map((v) => ({
            id: v.id,
            name: v.name,
            isControl: v.isControl,
            trafficWeight: v.trafficWeight,
            changes: (v.changes as any[]) || [],
          })),
        })
      ),
      goals: goals.map(
        //@ts-ignore
        (goal): SDKGoal => ({
          id: goal.id,
          name: goal.name,
          type: goal.type,
          urlPattern: goal.urlPattern,
          selector: goal.selector,
          eventName: goal.eventName,
          revenueTracking: goal.revenueTracking,
          //@ts-ignore
          experimentIds: goal.experimentGoals.map((eg) => eg.experimentId),
        })
      ),
      globalJS: project.globalJS,
    };

    // 5. Cache header'ı ile döndür (60 saniye)
    return successWithCache(config, 60);
  } catch (err) {
    console.error("Config Handler Error:", err);
    return error("Internal server error", 500, err);
  }
};

/**
 * Location kurallarından URL pattern (regex) oluşturur
 */
function buildUrlPattern(
  locations: Array<{
    type: string;
    matchType: string;
    value: string;
  }>
): string {
  if (!locations || locations.length === 0) {
    return ".*"; // Tüm URL'lerle eşleş
  }

  const patterns = locations
    .filter((loc) => loc.type === "URL")
    .map((loc) => {
      const value = escapeRegex(loc.value);

      switch (loc.matchType) {
        case "EXACTLY":
          return `^${value}$`;
        case "CONTAINS":
          return value;
        case "NOT_CONTAINS":
          return `^(? !.*${value}).*$`;
        case "STARTS_WITH":
          return `^${value}`;
        case "ENDS_WITH":
          return `${value}$`;
        case "REGEX":
          return loc.value; // Zaten regex, escape etme
        default:
          return value;
      }
    });

  return patterns.length > 0 ? patterns.join("|") : ".*";
}

/**
 * Regex özel karakterlerini escape eder
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Database audience type'ını SDK formatına çevirir
 */
function mapAudienceType(dbType: string): string {
  // Device types
  if (dbType.startsWith("DEVICE_")) return "DEVICE";

  // Browser types
  if (dbType.startsWith("BROWSER_")) return "BROWSER";

  // OS types
  if (dbType.startsWith("OS_")) return "OS";

  // Custom types
  if (dbType === "CUSTOM_COOKIE") return "COOKIE";
  if (dbType === "CUSTOM_QUERY_PARAM") return "QUERY_PARAM";
  if (dbType === "CUSTOM_JAVASCRIPT") return "JS_VAR";

  // Geography
  if (dbType.startsWith("FROM_")) return "GEO";

  // Traffic sources
  if (dbType.includes("TRAFFIC")) return "TRAFFIC_SOURCE";

  // Visitor type
  if (dbType === "NEW_VISITORS" || dbType === "RETURNING_VISITORS")
    return "VISITOR_TYPE";

  // Time based
  if (dbType.startsWith("VISITING_")) return "TIME";

  // Default
  return "OTHER";
}
