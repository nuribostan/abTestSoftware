import { PrismaClient } from "@prisma/client";

// Lambda cold start optimization
// Her Lambda instance'ı için tek bir Prisma client
let prisma: PrismaClient | null = null;

export const getPrismaClient = (): PrismaClient => {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env. DATABASE_URL,
        },
      },
      // Lambda için connection pool ayarları
      log: process.env.DEBUG === "true" ? ["query", "error", "warn"] : ["error"],
    });
  }
  return prisma;
};

// Lambda sonlanırken connection'ı kapat
export const disconnectPrisma = async (): Promise<void> => {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
};