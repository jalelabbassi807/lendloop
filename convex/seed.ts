import { ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";
import { todayUtc } from "./lib/dates";
import { enqueueLoanEvent } from "./notifications";

const DAY = 86_400_000;
const isoDate = (days: number) => todayUtc(Date.now() + days * DAY);

// npx convex run seed:demo  (see README)
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const realUser = (await ctx.db.query("users").take(50)).find((u) => !u.tokenIdentifier.startsWith("seed|"));
    if (!realUser) throw new ConvexError("Sign in once first so there's a real user to attach demo loans to.");
    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "seed|sam"))
      .unique();
    if (existing) return "Demo data already exists.";

    const samId = await ctx.db.insert("users", {
      tokenIdentifier: "seed|sam",
      name: "Sam Rivera",
      email: "sam@example.com",
      role: "user",
      trustedLender: true,
    });
    const ladderId = await ctx.db.insert("tools", {
      ownerId: samId,
      name: "Extension ladder",
      category: "hand_tools",
      condition: "good",
      description: "6 m aluminium ladder. Needs two people to carry.",
    });
    await ctx.db.insert("tools", {
      ownerId: samId,
      name: "4-person tent",
      category: "camping",
      condition: "fair",
      description: "Pitches in 10 minutes. One pole is taped.",
    });

    await ctx.db.insert("loans", {
      toolId: ladderId,
      toolName: "Extension ladder",
      lenderId: samId,
      borrowerId: realUser._id,
      startDate: isoDate(-6),
      endDate: isoDate(-2),
      status: "approved",
      decidedAt: Date.now() - 6 * DAY,
    });

    const myTool = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", realUser._id))
      .first();
    if (myTool) {
      const loanId = await ctx.db.insert("loans", {
        toolId: myTool._id,
        toolName: myTool.name,
        lenderId: realUser._id,
        borrowerId: samId,
        startDate: isoDate(1),
        endDate: isoDate(3),
        status: "pending",
      });
      await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "request_created");
    }
    return "Demo data created.";
  },
});
