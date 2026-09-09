import type { LoaderFunctionArgs } from "@remix-run/node";

import prisma from "../db.server";

/**
 * Unauthenticated liveness probe for the platform's health check.
 *
 * It touches the database on purpose: the failure mode that matters for this
 * app is not "the process is up" but "the process is up and its volume is
 * mounted". A container that boots without its database would happily serve
 * pages and silently lose the double-booking guard.
 *
 * Deliberately returns nothing about the shop or the tenant.
 */
export const loader = async (_args: LoaderFunctionArgs) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, reason: "database" }), {
      status: 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }
};
