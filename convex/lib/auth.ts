import { ConvexError } from "convex/values";
import type { UserIdentity } from "convex/server";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type Ctx = QueryCtx | MutationCtx;

export const DEFAULT_NAME = "Neighbor";

// Checked against the token on every admin call, not the stored role, so taking
// someone off ADMIN_EMAILS works right away.
export function isAdmin(identity: UserIdentity): boolean {
  const email = identity.email?.toLowerCase();
  if (!email || identity.emailVerified !== true) return false;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase());
  return admins.includes(email);
}

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !isAdmin(identity)) throw new ConvexError("Admins only.");
  return user;
}

export function displayName(user: Doc<"users">): string {
  return user.name.trim().split(/\s+/)[0] || DEFAULT_NAME;
}
