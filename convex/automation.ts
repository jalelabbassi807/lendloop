import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { automationKind, sendStatus } from "./schema";
import { displayName, requireAdmin } from "./lib/auth";
import { daysBetween, isValidDate } from "./lib/dates";
import { parseEventKey } from "./notifications";

const overdueKey = (loanId: string, date: string) => `overdue:${loanId}:${date}`;
const BATCH = 200;

// Skips loans already reminded today, so running the workflow again picks up the rest.
export const overdueLoans = internalQuery({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const loans = ctx.db
      .query("loans")
      .withIndex("by_status_and_end", (q) => q.eq("status", "approved").lt("endDate", today));

    const result = [];
    for await (const loan of loans) {
      if (result.length >= BATCH) break;
      const key = overdueKey(loan._id, today);
      const reminded = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", key))
        .unique();
      if (reminded?.status === "sent") continue;

      const borrower = await ctx.db.get(loan.borrowerId);
      if (!borrower) continue;
      result.push({
        loanId: loan._id,
        idempotencyKey: key,
        reminderDate: today,
        toolName: loan.toolName,
        endDate: loan.endDate,
        daysOverdue: daysBetween(loan.endDate, today),
        borrower: { firstName: displayName(borrower), email: borrower.email ?? null },
      });
    }
    return result;
  },
});

// Repeating a key is a no-op, except that "sent" replaces an earlier "failed".
export const recordResult = internalMutation({
  args: {
    idempotencyKey: v.string(),
    kind: automationKind,
    status: sendStatus,
    loanId: v.optional(v.string()),
    reminderDate: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loanId = args.loanId ? ctx.db.normalizeId("loans", args.loanId) : null;
    if (args.loanId && !loanId) throw new ConvexError("Unknown loanId.");
    if (args.kind !== "workflow_error" && !loanId) throw new ConvexError("loanId is required.");

    if (args.kind === "overdue_reminder") {
      if (!args.reminderDate || !isValidDate(args.reminderDate)) throw new ConvexError("reminderDate is required.");
      if (args.idempotencyKey !== overdueKey(loanId!, args.reminderDate)) {
        throw new ConvexError("idempotencyKey does not match loanId and reminderDate.");
      }
    }
    if (args.kind === "request_notification" && parseEventKey(args.idempotencyKey)?.loanId !== loanId) {
      throw new ConvexError("idempotencyKey does not match loanId.");
    }

    const detail = args.detail?.slice(0, 500);
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();

    if (existing) {
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", detail });
        return { duplicate: false, id: existing._id };
      }
      return { duplicate: true, id: existing._id };
    }

    const id = await ctx.db.insert("automationEvents", {
      idempotencyKey: args.idempotencyKey,
      kind: args.kind,
      status: args.status,
      loanId: loanId ?? undefined,
      reminderDate: args.reminderDate,
      detail,
    });
    return { duplicate: false, id };
  },
});

export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const deliveries = (status: "failed" | "pending") =>
      ctx.db
        .query("webhookDeliveries")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(50);
    const failures = (kind: Doc<"automationEvents">["kind"]) =>
      ctx.db
        .query("automationEvents")
        .withIndex("by_kind_and_status", (q) => q.eq("kind", kind).eq("status", "failed"))
        .order("desc")
        .take(20);

    const [failed, pending, notifications, reminders, errors] = await Promise.all([
      deliveries("failed"),
      deliveries("pending"),
      failures("request_notification"),
      failures("overdue_reminder"),
      failures("workflow_error"),
    ]);

    const delivery = (d: (typeof failed)[number]) => ({
      _id: d._id,
      eventKey: d.eventKey,
      attempts: d.attempts,
      lastError: d.lastError ?? null,
      nextAttemptAt: d.nextAttemptAt ?? null,
    });
    return {
      failedDeliveries: failed.map(delivery),
      retryingDeliveries: pending.filter((d) => d.attempts > 0).map(delivery),
      failedSends: [...notifications, ...reminders]
        .sort((a, b) => b._creationTime - a._creationTime)
        .slice(0, 20)
        .map((e) => ({ _id: e._id, idempotencyKey: e.idempotencyKey, detail: e.detail ?? "", at: e._creationTime })),
      workflowErrors: errors.map((e) => ({ _id: e._id, detail: e.detail ?? "", at: e._creationTime })),
    };
  },
});

export const retryDelivery = mutation({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    await requireAdmin(ctx);
    const d = await ctx.db.get(deliveryId);
    if (!d || d.status !== "failed") throw new ConvexError("Only failed deliveries can be retried.");
    await ctx.db.patch(deliveryId, { status: "pending", attempts: 0, lastError: undefined, nextAttemptAt: undefined });
    await ctx.scheduler.runAfter(0, internal.notifications.deliver, { deliveryId });
  },
});

export const dismissWorkflowError = mutation({
  args: { eventId: v.id("automationEvents") },
  handler: async (ctx, { eventId }) => {
    await requireAdmin(ctx);
    const e = await ctx.db.get(eventId);
    if (e?.kind === "workflow_error") await ctx.db.delete(eventId);
  },
});
