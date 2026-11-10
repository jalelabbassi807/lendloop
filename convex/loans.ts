import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { displayName, requireAdmin, requireUser } from "./lib/auth";
import { MAX_LOAN_DAYS, daysBetween, isValidDate, rangesOverlap, todayUtc } from "./lib/dates";
import { RECIPIENT, enqueueLoanEvent, parseEventKey } from "./notifications";
import { approvedLoans } from "./tools";

// A late loan that isn't back yet keeps the tool busy up to today.
function blocks(loan: Doc<"loans">, start: string, end: string, today: string) {
  const busyUntil = loan.endDate < today ? today : loan.endDate;
  return rangesOverlap(loan.startDate, busyUntil, start, end);
}

async function getLoan(ctx: MutationCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError("Request not found.");
  return loan;
}

function assertPending(loan: Doc<"loans">) {
  if (loan.status !== "pending") throw new ConvexError(`This request is already ${loan.status}.`);
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found.");
    if (tool.ownerId === me._id) throw new ConvexError("You can't borrow your own tool.");

    const today = todayUtc();
    if (!isValidDate(startDate) || !isValidDate(endDate)) throw new ConvexError("Dates must be YYYY-MM-DD.");
    if (startDate < today) throw new ConvexError("Start date can't be in the past.");
    if (endDate < startDate) throw new ConvexError("End date must be on or after the start date.");
    if (daysBetween(startDate, endDate) + 1 > MAX_LOAN_DAYS) {
      throw new ConvexError(`Loans can be at most ${MAX_LOAN_DAYS} days.`);
    }

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) => q.eq("toolId", toolId).eq("status", "pending"))
      .collect();
    if (pending.some((l) => l.borrowerId === me._id)) {
      throw new ConvexError("You already have a pending request for this tool.");
    }
    if ((await approvedLoans(ctx, toolId)).some((l) => blocks(l, startDate, endDate, today))) {
      throw new ConvexError("The tool isn't free on those dates.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      lenderId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "pending",
    });
    await enqueueLoanEvent(ctx, (await ctx.db.get(loanId))!, "request_created");
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.lenderId !== me._id) throw new ConvexError("Only the tool's owner can approve this request.");
    assertPending(loan);

    const today = todayUtc();
    if (loan.endDate < today) throw new ConvexError("These dates have already passed.");
    if ((await approvedLoans(ctx, loan.toolId)).some((l) => blocks(l, loan.startDate, loan.endDate, today))) {
      throw new ConvexError("The tool is already lent out for some of these dates.");
    }

    const now = Date.now();
    await ctx.db.patch(loanId, { status: "approved", decidedAt: now });
    await enqueueLoanEvent(ctx, loan, "approved");

    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool_and_status", (q) => q.eq("toolId", loan.toolId).eq("status", "pending"))
      .collect();
    for (const other of pending) {
      if (other._id === loanId || !rangesOverlap(other.startDate, other.endDate, loan.startDate, loan.endDate)) continue;
      await ctx.db.patch(other._id, { status: "declined", decidedAt: now });
      await enqueueLoanEvent(ctx, other, "declined");
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.lenderId !== me._id) throw new ConvexError("Only the tool's owner can decline this request.");
    assertPending(loan);
    await ctx.db.patch(loanId, { status: "declined", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, loan, "declined");
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.borrowerId !== me._id) throw new ConvexError("You can only cancel your own requests.");
    assertPending(loan);
    await ctx.db.patch(loanId, { status: "cancelled", decidedAt: Date.now() });
    await enqueueLoanEvent(ctx, loan, "cancelled_by_borrower");
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.lenderId !== me._id) throw new ConvexError("Only the tool's owner can mark it returned.");
    if (loan.status !== "approved") throw new ConvexError("Only approved loans can be marked returned.");
    await ctx.db.patch(loanId, { status: "returned", returnedAt: Date.now() });
    await enqueueLoanEvent(ctx, loan, "returned");
  },
});

type Viewer = "borrower" | "lender" | "admin";

function sentTo(key: string) {
  if (key.startsWith("overdue:")) return "borrower";
  const parsed = parseEventKey(key);
  return parsed ? RECIPIENT[parsed.event] : null;
}

async function describe(ctx: QueryCtx, loan: Doc<"loans">, viewer: Viewer) {
  const [borrower, lender, events] = await Promise.all([
    ctx.db.get(loan.borrowerId),
    ctx.db.get(loan.lenderId),
    ctx.db
      .query("automationEvents")
      .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
      .order("desc")
      .take(10),
  ]);
  const today = todayUtc();
  const activity = events
    .filter((e) => viewer === "admin" || sentTo(e.idempotencyKey) === viewer)
    .slice(0, 3)
    .map((e) => ({ kind: e.kind, status: e.status, at: e._creationTime }));

  return {
    _id: loan._id,
    toolName: loan.toolName,
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < today,
    expired: loan.status === "pending" && loan.endDate < today,
    borrowerName: viewer !== "borrower" && borrower ? displayName(borrower) : null,
    lenderName: viewer !== "lender" && lender ? displayName(lender) : null,
    lenderTrusted: lender?.trustedLender ?? false,
    activity,
  };
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => describe(ctx, l, "borrower")));
  },
});

export const incomingRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", me._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => describe(ctx, l, "lender")));
  },
});

export const listAllForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return Promise.all(loans.map((l) => describe(ctx, l, "admin")));
  },
});
