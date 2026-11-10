import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { category, condition } from "./schema";
import { DEFAULT_NAME, displayName, isAdmin, requireUser } from "./lib/auth";
import { todayUtc } from "./lib/dates";
import { enqueueLoanEvent } from "./notifications";

const toolFields = { name: v.string(), category, condition, description: v.string() };

function clean(fields: { name: string; description: string }) {
  const name = fields.name.trim();
  const description = fields.description.trim();
  if (!name) throw new ConvexError("Name is required.");
  if (name.length > 80) throw new ConvexError("Name must be at most 80 characters.");
  if (description.length > 500) throw new ConvexError("Description must be at most 500 characters.");
  return { name, description };
}

export function approvedLoans(ctx: QueryCtx, toolId: Id<"tools">) {
  return ctx.db
    .query("loans")
    .withIndex("by_tool_and_status", (q) => q.eq("toolId", toolId).eq("status", "approved"))
    .collect();
}

async function availability(ctx: QueryCtx, toolId: Id<"tools">) {
  const today = todayUtc();
  const current = (await approvedLoans(ctx, toolId)).find((l) => l.startDate <= today);
  return current
    ? { status: "on_loan" as const, until: current.endDate }
    : { status: "available" as const, until: null };
}

function summary(t: Doc<"tools">) {
  return { _id: t._id, name: t.name, category: t.category, condition: t.condition, description: t.description };
}

// public page: tools that aren't out right now, name and category only
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const free = [];
    for (const t of tools) {
      if ((await availability(ctx, t._id)).status === "available") {
        free.push({ _id: t._id, name: t.name, category: t.category });
      }
    }
    return free;
  },
});

export const list = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .order("desc")
          .take(200)
      : await ctx.db.query("tools").order("desc").take(200);

    return Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        return {
          ...summary(t),
          ownerName: owner ? displayName(owner) : DEFAULT_NAME,
          ownerTrusted: owner?.trustedLender ?? false,
          isMine: t.ownerId === me._id,
          availability: await availability(ctx, t._id),
        };
      }),
    );
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .order("desc")
      .collect();
    return Promise.all(tools.map(async (t) => ({ ...summary(t), availability: await availability(ctx, t._id) })));
  },
});

export const create = mutation({
  args: toolFields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", { ...args, ...clean(args), ownerId: me._id });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...toolFields },
  handler: async (ctx, { toolId, ...fields }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Listing not found.");
    if (tool.ownerId !== me._id) throw new ConvexError("You can only edit your own listings.");
    await ctx.db.patch(toolId, { ...fields, ...clean(fields) });
  },
});

// Admins can remove any listing. A loan that's already out is left alone: the
// borrower still has the tool and should keep getting reminders.
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Listing not found.");
    const identity = await ctx.auth.getUserIdentity();
    const admin = identity !== null && isAdmin(identity);
    if (tool.ownerId !== me._id && !admin) throw new ConvexError("You can only delete your own listings.");

    const approved = await approvedLoans(ctx, toolId);
    if (!admin && approved.length > 0) {
      throw new ConvexError("This tool is lent out or booked. Mark it returned first.");
    }

    const today = todayUtc();
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    const notStarted = approved.filter((l) => l.startDate > today);
    for (const loan of [...pending, ...notStarted]) {
      await ctx.db.patch(loan._id, { status: "cancelled", decidedAt: Date.now() });
      await enqueueLoanEvent(ctx, loan, "listing_removed");
    }
    await ctx.db.delete(toolId);
  },
});
