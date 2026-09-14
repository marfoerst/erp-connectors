import { loadDotenv } from "./config.js";

// Before the client is constructed: Prisma reads DATABASE_URL at construction.
loadDotenv();

const { PrismaClient } = await import("../generated/prisma/index.js");

declare global {
  // eslint-disable-next-line no-var
  var __mgPrisma: InstanceType<typeof PrismaClient> | undefined;
}

const prisma = global.__mgPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__mgPrisma = prisma;

export default prisma;
