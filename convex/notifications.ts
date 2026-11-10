import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { displayName } from "./lib/auth";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign } from "./lib/hmac";

export const RECIPIENT = {
  request_created: "lender",
  cancelled_by_borrower: "lender",
  approved: "borrower",
  declined: "borrower",
  returned: "borrower",
  listing_removed: "borrower",
} as const;

type LoanEvent = keyof typeof RECIPIENT;

// "loan:<loanId>:<event>"
export function parseEventKey(key: string): { loanId: string; event: LoanEvent } | null {
  const [prefix, loanId, event] = key.split(":");
  if (prefix !== "loan" || !loanId || !event || !Object.hasOwn(RECIPIENT, event)) return null;
  return { loanId, event: event as LoanEvent };
}

const MAX_ATTEMPTS = 5;
const retryDelayMs = (attempts: number) => 30_000 * 4 ** (attempts - 1); // 30s, 2m, 8m, 32m

// Call from the same mutation that changes the loan, so the event is saved
// (and scheduled) only if the change is.
export async function enqueueLoanEvent(ctx: MutationCtx, loan: Doc<"loans">, event: LoanEvent) {
  const eventKey = `loan:${loan._id}:${event}`;
  const existing = await ctx.db
    .query("webhookDeliveries")
    .withIndex("by_event_key", (q) => q.eq("eventKey", eventKey))
    .unique();
  if (existing) return;

  const recipient = await ctx.db.get(RECIPIENT[event] === "lender" ? loan.lenderId : loan.borrowerId);
  if (!recipient) return;

  const payload = JSON.stringify({
    eventKey,
    event,
    loanId: loan._id,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    recipient: { firstName: displayName(recipient), email: recipient.email ?? null },
  });

  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    eventKey,
    loanId: loan._id,
    payload,
    status: "pending",
    attempts: 0,
  });
  await ctx.scheduler.runAfter(0, internal.notifications.deliver, { deliveryId });
}

export const getDelivery = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: (ctx, { deliveryId }) => ctx.db.get(deliveryId),
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    permanent: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { deliveryId, ok, permanent, error }) => {
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status !== "pending") return;
    const attempts = d.attempts + 1;

    if (ok) {
      await ctx.db.patch(deliveryId, { status: "delivered", attempts, lastError: undefined, nextAttemptAt: undefined });
    } else if (permanent || attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(deliveryId, { status: "failed", attempts, lastError: error, nextAttemptAt: undefined });
    } else {
      const delay = retryDelayMs(attempts);
      await ctx.db.patch(deliveryId, { attempts, lastError: error, nextAttemptAt: Date.now() + delay });
      await ctx.scheduler.runAfter(delay, internal.notifications.deliver, { deliveryId });
    }
  },
});

// Retrying these won't help. 404 is retried on purpose: n8n returns it while restarting.
const NO_RETRY = [400, 401, 403, 422];

export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const d = await ctx.runQuery(internal.notifications.getDelivery, { deliveryId });
    if (!d || d.status !== "pending") return;

    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.CONVEX_TO_N8N_SECRET;
    if (!url || !secret) {
      await ctx.runMutation(internal.notifications.recordAttempt, {
        deliveryId,
        ok: false,
        permanent: true,
        error: "N8N_REQUEST_WEBHOOK_URL or CONVEX_TO_N8N_SECRET is not set",
      });
      return;
    }

    const timestamp = String(Math.floor(Date.now() / 1000));
    let ok = false;
    let permanent = false;
    let error: string | undefined;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": d.eventKey,
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: await sign(secret, timestamp, d.payload),
        },
        body: d.payload,
        signal: AbortSignal.timeout(15_000),
      });
      ok = res.ok;
      if (!ok) {
        error = `HTTP ${res.status}`;
        permanent = NO_RETRY.includes(res.status);
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await ctx.runMutation(internal.notifications.recordAttempt, { deliveryId, ok, permanent, error });
  },
});
