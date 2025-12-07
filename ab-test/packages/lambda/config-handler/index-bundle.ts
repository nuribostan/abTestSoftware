// Prisma'yı farklı şekilde import et
const { PrismaClient } = require("./client");

// ============================================
// PRISMA CLIENT (Singleton)
// ============================================
let prisma: any = null;

function getPrismaClient() {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env. DATABASE_URL,
        },
      },
    });
  }
  return prisma;
}

// ============================================
// RESPONSE HELPERS
// ============================================
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

function success(data: any, statusCode = 200) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON. stringify(data),
  };
}

function successWithCache(data: any, maxAge = 60) {
  return {
    statusCode: 200,
    headers: {
      ... corsHeaders,
      "Cache-Control": `public, max-age=${maxAge}`,
    },
    body: JSON. stringify(data),
  };
}

function notFound(message: string) {
  return {
    statusCode: 404,
    headers: corsHeaders,
    body: JSON.stringify({ error: message }),
  };
}

function badRequest(message: string) {
  return {
    statusCode: 400,
    headers: corsHeaders,
    body: JSON.stringify({ error: message }),
  };
}

function error(message: string, statusCode = 500, details?: any) {
  return {
    statusCode,
    headers: corsHeaders,
    body: JSON.stringify({ error: message, details: details?. message }),
  };
}

function cors() {
  return {
    statusCode: 200,
    headers: corsHeaders,
    body: "",
  };
}

// ============================================
// HANDLER
// ============================================
export const handler = async (event: any) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  // CORS preflight
  if (event.httpMethod === "OPTIONS" || event.requestContext?.http?.method === "OPTIONS") {
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
            isControl: "desc",
          },
        },
      },
    });

    // 3.  Aktif goal'ları getir
    const goals = await db.goal. findMany({
      where: {
        projectId: project. id,
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
    const config = {
      projectId: project.id,
      version: Date.now(),
      experiments: experiments.map((exp: any) => ({
        id: exp.id,
        name: exp.name,
        type: exp.type,
        status: "RUNNING",
        trafficAllocation: exp.trafficAllocation,
        urlPattern: buildUrlPattern(exp.locations),
        audiences: exp.audiences.map((aud: any) => ({
          type: mapAudienceType(aud.type),
          operator: aud. operator,
          value: aud.value,
          condition: aud.condition,
        })),
        variants: exp. variants.map((v: any) => ({
          id: v.id,
          name: v.name,
          isControl: v.isControl,
          trafficWeight: v.trafficWeight,
          changes: v.changes || [],
        })),
      })),
      goals: goals.map((goal: any) => ({
        id: goal. id,
        name: goal.name,
        type: goal.type,
        urlPattern: goal. urlPattern,
        selector: goal.selector,
        eventName: goal.eventName,
        revenueTracking: goal.revenueTracking,
        experimentIds: goal.experimentGoals.map((eg: any) => eg.experimentId),
      })),
      globalJS: project. globalJS,
    };

    // 5. Cache header'ı ile döndür
    return successWithCache(config, 60);
  } catch (err: any) {
    console.error("Config Handler Error:", err);
    return error("Internal server error", 500, err);
  }
};

// ============================================
// HELPER FUNCTIONS
// ============================================
function buildUrlPattern(
  locations: Array<{ type: string; matchType: string; value: string }>
): string {
  if (!locations || locations.length === 0) {
    return ".*";
  }

  const patterns = locations
    .filter((loc) => loc.type === "URL")
    .map((loc) => {
      const value = escapeRegex(loc.value);

      switch (loc. matchType) {
        case "EXACTLY":
          return `^${value}$`;
        case "CONTAINS":
          return value;
        case "NOT_CONTAINS":
          return `^(? ! .*${value}).*$`;
        case "STARTS_WITH":
          return `^${value}`;
        case "ENDS_WITH":
          return `${value}$`;
        case "REGEX":
          return loc.value;
        default:
          return value;
      }
    });

  return patterns.length > 0 ? patterns.join("|") : ".*";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapAudienceType(dbType: string): string {
  if (dbType.startsWith("DEVICE_")) return "DEVICE";
  if (dbType.startsWith("BROWSER_")) return "BROWSER";
  if (dbType.startsWith("OS_")) return "OS";
  if (dbType === "CUSTOM_COOKIE") return "COOKIE";
  if (dbType === "CUSTOM_QUERY_PARAM") return "QUERY_PARAM";
  if (dbType === "CUSTOM_JAVASCRIPT") return "JS_VAR";
  if (dbType.startsWith("FROM_")) return "GEO";
  if (dbType.includes("TRAFFIC")) return "TRAFFIC_SOURCE";
  if (dbType === "NEW_VISITORS" || dbType === "RETURNING_VISITORS") return "VISITOR_TYPE";
  if (dbType.startsWith("VISITING_")) return "TIME";
  return "OTHER";
}