import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const CATEGORIES = ["power_tools", "hand_tools", "garden", "kitchen", "camping", "cleaning", "other"] as const;
export const CONDITIONS = ["new", "good", "fair", "worn"] as const;
export const AUTOMATION_KINDS = ["request_notification", "overdue_reminder", "workflow_error"] as const;
const LOAN_STATUSES = ["pending", "approved", "declined", "cancelled", "returned"] as const;

const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((x) => v.literal(x)));
export const category = literals(CATEGORIES);
export const condition = literals(CONDITIONS);
export const automationKind = literals(AUTOMATION_KINDS);
export const sendStatus = v.union(v.literal("sent"), v.literal("failed"));

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(), // kept so the loan still makes sense if the tool is deleted
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    status: literals(LOAN_STATUSES),
    decidedAt: v.optional(v.number()),
    returnedAt: v.optional(v.number()),
  })
    .index("by_tool_and_status", ["toolId", "status"])
    .index("by_borrower", ["borrowerId"])
    .index("by_lender", ["lenderId"])
    .index("by_status_and_end", ["status", "endDate"]),

  webhookDeliveries: defineTable({
    eventKey: v.string(),
    loanId: v.id("loans"),
    payload: v.string(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    attempts: v.number(),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
  })
    .index("by_event_key", ["eventKey"])
    .index("by_status", ["status"]),

  automationEvents: defineTable({
    idempotencyKey: v.string(),
    loanId: v.optional(v.id("loans")),
    kind: automationKind,
    status: sendStatus,
    detail: v.optional(v.string()),
    reminderDate: v.optional(v.string()),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"])
    .index("by_kind_and_status", ["kind", "status"]),
});
