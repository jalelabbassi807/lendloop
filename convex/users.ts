import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { DEFAULT_NAME, displayName, getCurrentUser, isAdmin, requireAdmin } from "./lib/auth";

// No arguments on purpose: everything comes from the verified Clerk token.
export const ensureUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("You must be signed in.");

    const email = identity.email?.toLowerCase();
    // Clerk sends "" for empty claims
    const name = identity.name?.trim() || identity.givenName?.trim() || identity.nickname?.trim() || DEFAULT_NAME;
    const role = isAdmin(identity) ? "admin" : "user";

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!existing) {
      return await ctx.db.insert("users", { tokenIdentifier: identity.tokenIdentifier, name, email, role, trustedLender: false });
    }
    if (existing.name !== name || existing.email !== email || existing.role !== role) {
      await ctx.db.patch(existing._id, { name, email, role });
    }
    return existing._id;
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return { _id: user._id, name: displayName(user), role: user.role, trustedLender: user.trustedLender };
  },
});

export const listForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const users = await ctx.db.query("users").take(500);
    return users.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email ?? null,
      role: u.role,
      trustedLender: u.trustedLender,
    }));
  },
});

export const setTrustedLender = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    if (!(await ctx.db.get(userId))) throw new ConvexError("User not found.");
    await ctx.db.patch(userId, { trustedLender: trusted });
  },
});
