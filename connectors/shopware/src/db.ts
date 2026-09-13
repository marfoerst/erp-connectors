import { loadDotenv } from "./env.js";

// Before the client is constructed: Prisma reads DATABASE_URL at construction,
// so loading afterwards would be too late to matter.
loadDotenv();

const { PrismaClient } = await import("../generated/prisma/index.js");

/**
 * One client for the process. Re-created on reload in dev, which otherwise
 * exhausts SQLite connections after a handful of saves.
 */
declare global {
  // eslint-disable-next-line no-var
  var __swPrisma: InstanceType<typeof PrismaClient> | undefined;
}

const prisma = global.__swPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") global.__swPrisma = prisma;

export default prisma;
