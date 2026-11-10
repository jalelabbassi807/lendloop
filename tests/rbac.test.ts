import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { isoDate, setup } from "./setup";

const drill = { name: "Cordless drill", category: "power_tools" as const, condition: "good" as const, description: "18V, two batteries" };

beforeEach(() => {
  process.env.ADMIN_EMAILS = "admin@lendloop.test";
});
afterEach(() => {
  delete process.env.ADMIN_EMAILS;
});

describe("public page", () => {
  test("only shows name and category", async () => {
    const { convex, signIn } = setup();
    const alice = await signIn("Alice Smith", "alice@lendloop.test");
    await alice.client.mutation(api.tools.create, drill);

    const list = await convex.query(api.tools.listPublic, {});
    expect(list).toHaveLength(1);
    expect(Object.keys(list[0]).sort()).toEqual(["_id", "category", "name"]);
  });

  test("tools that are out on loan don't show", async () => {
    const { convex, signIn } = setup();
    const alice = await signIn("Alice", "alice@lendloop.test");
    const bob = await signIn("Bob", "bob@lendloop.test");
    const toolId = await alice.client.mutation(api.tools.create, drill);
    await alice.client.mutation(api.tools.create, { ...drill, name: "Rake", category: "garden" });

    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(0), endDate: isoDate(2) });
    await alice.client.mutation(api.loans.approve, { loanId });
    expect((await convex.query(api.tools.listPublic, {})).map((t) => t.name)).toEqual(["Rake"]);

    await alice.client.mutation(api.loans.markReturned, { loanId });
    expect(await convex.query(api.tools.listPublic, {})).toHaveLength(2);
  });

  test("everything else needs an account", async () => {
    const { convex } = setup();
    await expect(convex.query(api.tools.list, {})).rejects.toThrow(/signed in/);
    await expect(convex.mutation(api.tools.create, drill)).rejects.toThrow(/signed in/);
  });
});

describe("listings", () => {
  test("only the owner can edit or delete, admins can remove anything", async () => {
    const { convex, signIn } = setup();
    const alice = await signIn("Alice", "alice@lendloop.test");
    const bob = await signIn("Bob", "bob@lendloop.test");
    const admin = await signIn("Ada", "admin@lendloop.test");
    const toolId = await alice.client.mutation(api.tools.create, drill);

    await expect(bob.client.mutation(api.tools.update, { toolId, ...drill, name: "Mine now" })).rejects.toThrow(/own listings/);
    await expect(bob.client.mutation(api.tools.remove, { toolId })).rejects.toThrow(/own listings/);

    await alice.client.mutation(api.tools.update, { toolId, ...drill, name: "Hammer drill" });
    expect((await alice.client.query(api.tools.myListings, {}))[0].name).toBe("Hammer drill");

    await admin.client.mutation(api.tools.remove, { toolId });
    expect(await convex.query(api.tools.listPublic, {})).toHaveLength(0);
  });

  test("name and description limits", async () => {
    const { signIn } = setup();
    const alice = await signIn("Alice", "alice@lendloop.test");
    await expect(alice.client.mutation(api.tools.create, { ...drill, name: "   " })).rejects.toThrow(/required/);
    await expect(alice.client.mutation(api.tools.create, { ...drill, name: "x".repeat(81) })).rejects.toThrow(/80/);
    await expect(alice.client.mutation(api.tools.create, { ...drill, description: "x".repeat(501) })).rejects.toThrow(/500/);
  });
});

describe("roles", () => {
  test("admin-only functions", async () => {
    const { signIn } = setup();
    const bob = await signIn("Bob", "bob@lendloop.test");
    const admin = await signIn("Ada", "admin@lendloop.test");
    expect((await bob.client.query(api.users.me, {}))?.role).toBe("user");
    expect((await admin.client.query(api.users.me, {}))?.role).toBe("admin");

    await expect(bob.client.query(api.users.listForAdmin, {})).rejects.toThrow(/Admins only/);
    await expect(bob.client.query(api.loans.listAllForAdmin, {})).rejects.toThrow(/Admins only/);
    await expect(bob.client.query(api.automation.health, {})).rejects.toThrow(/Admins only/);
    await expect(bob.client.mutation(api.users.setTrustedLender, { userId: bob.id, trusted: true })).rejects.toThrow(/Admins only/);

    await admin.client.mutation(api.users.setTrustedLender, { userId: bob.id, trusted: true });
    expect((await bob.client.query(api.users.me, {}))?.trustedLender).toBe(true);
  });

  test("admin needs a verified address on the list", async () => {
    const { signIn } = setup();
    const unverified = await signIn("Eve", "admin@lendloop.test", false);
    expect((await unverified.client.query(api.users.me, {}))?.role).toBe("user");
    await expect(unverified.client.query(api.users.listForAdmin, {})).rejects.toThrow(/Admins only/);
  });

  test("taking someone off ADMIN_EMAILS works without them signing in again", async () => {
    const { signIn } = setup();
    const alice = await signIn("Alice", "alice@lendloop.test");
    const toolId = await alice.client.mutation(api.tools.create, drill);
    const admin = await signIn("Ada", "admin@lendloop.test");
    await admin.client.query(api.users.listForAdmin, {});

    process.env.ADMIN_EMAILS = "someone-else@lendloop.test";
    await expect(admin.client.query(api.users.listForAdmin, {})).rejects.toThrow(/Admins only/);
    await expect(admin.client.mutation(api.tools.remove, { toolId })).rejects.toThrow(/own listings/);
  });

  test("no name on the account doesn't leak the email", async () => {
    const { signIn } = setup();
    const anon = await signIn("", "jane.doe42@lendloop.test");
    expect((await anon.client.query(api.users.me, {}))?.name).toBe("Neighbor");
  });
});

describe("borrowing", () => {
  async function world() {
    const app = setup();
    const alice = await app.signIn("Alice", "alice@lendloop.test");
    const bob = await app.signIn("Bob", "bob@lendloop.test");
    const carol = await app.signIn("Carol", "carol@lendloop.test");
    const toolId = await alice.client.mutation(api.tools.create, drill);
    return { ...app, alice, bob, carol, toolId };
  }

  test("own tool, bad dates, duplicates", async () => {
    const { alice, bob, toolId } = await world();
    const ask = (start: number, end: number) =>
      bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(start), endDate: isoDate(end) });

    await expect(alice.client.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(2) })).rejects.toThrow(/own tool/);
    await expect(ask(-1, 2)).rejects.toThrow(/past/);
    await expect(ask(3, 2)).rejects.toThrow(/on or after/);
    await expect(ask(1, 60)).rejects.toThrow(/at most/);

    await ask(1, 2);
    await expect(ask(5, 6)).rejects.toThrow(/already have a pending/);
  });

  test("lender decides; approving declines overlapping requests only", async () => {
    const { convex, alice, bob, carol, toolId } = await world();
    const bobLoan = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(3) });
    const carolLoan = await carol.client.mutation(api.loans.request, { toolId, startDate: isoDate(2), endDate: isoDate(4) });

    await expect(bob.client.mutation(api.loans.approve, { loanId: bobLoan })).rejects.toThrow(/owner/);
    await expect(carol.client.mutation(api.loans.decline, { loanId: bobLoan })).rejects.toThrow(/owner/);
    await expect(carol.client.mutation(api.loans.cancel, { loanId: bobLoan })).rejects.toThrow(/your own/);

    await alice.client.mutation(api.loans.approve, { loanId: bobLoan });
    const status = async (id: Id<"loans">) =>
      (await alice.client.query(api.loans.incomingRequests, {})).find((l) => l._id === id)?.status;
    expect(await status(bobLoan)).toBe("approved");
    expect(await status(carolLoan)).toBe("declined");

    const later = await carol.client.mutation(api.loans.request, { toolId, startDate: isoDate(10), endDate: isoDate(11) });
    expect(await status(later)).toBe("pending");
    await expect(bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(3), endDate: isoDate(5) })).rejects.toThrow(/isn't free/);

    await expect(bob.client.mutation(api.loans.markReturned, { loanId: bobLoan })).rejects.toThrow(/owner/);
    await alice.client.mutation(api.loans.markReturned, { loanId: bobLoan });
    expect(await status(bobLoan)).toBe("returned");

    expect(JSON.stringify(await alice.client.query(api.loans.incomingRequests, {}))).not.toContain("@lendloop.test");

    const keys = await convex.run(async (ctx) => (await ctx.db.query("webhookDeliveries").collect()).map((d) => d.eventKey));
    expect(keys.filter((k) => k.startsWith(`loan:${bobLoan}:`)).sort()).toEqual([
      `loan:${bobLoan}:approved`,
      `loan:${bobLoan}:request_created`,
      `loan:${bobLoan}:returned`,
    ]);
  });

  test("borrower can cancel a pending request", async () => {
    const { bob, toolId } = await world();
    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(2) });
    await bob.client.mutation(api.loans.cancel, { loanId });
    expect((await bob.client.query(api.loans.myRequests, {}))[0].status).toBe("cancelled");
    await expect(bob.client.mutation(api.loans.cancel, { loanId })).rejects.toThrow(/already cancelled/);
  });

  test("owner can't delete a tool that's out; admin removal keeps that loan, cancels the rest", async () => {
    const { convex, signIn, alice, bob, carol, toolId } = await world();
    const admin = await signIn("Ada", "admin@lendloop.test");
    const out = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(0), endDate: isoDate(2) });
    await alice.client.mutation(api.loans.approve, { loanId: out });
    const booked = await carol.client.mutation(api.loans.request, { toolId, startDate: isoDate(5), endDate: isoDate(6) });
    await alice.client.mutation(api.loans.approve, { loanId: booked });
    const pending = await carol.client.mutation(api.loans.request, { toolId, startDate: isoDate(8), endDate: isoDate(9) });

    await expect(alice.client.mutation(api.tools.remove, { toolId })).rejects.toThrow(/lent out/);
    await admin.client.mutation(api.tools.remove, { toolId });

    const loans = await convex.run((ctx) => ctx.db.query("loans").collect());
    const statusOf = (id: Id<"loans">) => loans.find((l) => l._id === id)?.status;
    expect(statusOf(out)).toBe("approved");
    expect(statusOf(booked)).toBe("cancelled");
    expect(statusOf(pending)).toBe("cancelled");
    expect((await bob.client.query(api.loans.myRequests, {}))[0].toolName).toBe("Cordless drill");

    const keys = await convex.run(async (ctx) => (await ctx.db.query("webhookDeliveries").collect()).map((d) => d.eventKey));
    expect(keys).toContain(`loan:${booked}:listing_removed`);
    expect(keys).toContain(`loan:${pending}:listing_removed`);
  });

  test("a late loan keeps the tool busy until it's returned", async () => {
    const { convex, signIn, alice, bob, carol, toolId } = await world();
    const late = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(0), endDate: isoDate(1) });
    await alice.client.mutation(api.loans.approve, { loanId: late });
    const next = await carol.client.mutation(api.loans.request, { toolId, startDate: isoDate(2), endDate: isoDate(3) });
    await convex.run((ctx) => ctx.db.patch(late, { startDate: isoDate(-5), endDate: isoDate(-2) }));

    const dan = await signIn("Dan", "dan@lendloop.test");
    await expect(dan.client.mutation(api.loans.request, { toolId, startDate: isoDate(0), endDate: isoDate(0) })).rejects.toThrow(/isn't free/);
    await convex.run((ctx) => ctx.db.patch(next, { startDate: isoDate(0), endDate: isoDate(1) }));
    await expect(alice.client.mutation(api.loans.approve, { loanId: next })).rejects.toThrow(/already lent out/);
  });

  test("a request whose dates have passed can't be approved", async () => {
    const { convex, alice, bob, toolId } = await world();
    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(0), endDate: isoDate(1) });
    await convex.run((ctx) => ctx.db.patch(loanId, { startDate: isoDate(-4), endDate: isoDate(-2) }));
    await expect(alice.client.mutation(api.loans.approve, { loanId })).rejects.toThrow(/already passed/);
    expect((await alice.client.query(api.loans.incomingRequests, {}))[0].expired).toBe(true);
  });

  test("each side only sees the notifications that went to them", async () => {
    const { convex, alice, bob, toolId } = await world();
    const loanId = await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(2) });
    await convex.run((ctx) =>
      ctx.db.insert("automationEvents", {
        idempotencyKey: `loan:${loanId}:request_created`,
        kind: "request_notification",
        status: "sent",
        loanId,
      }),
    );
    expect((await alice.client.query(api.loans.incomingRequests, {}))[0].activity).toHaveLength(1);
    expect((await bob.client.query(api.loans.myRequests, {}))[0].activity).toHaveLength(0);
  });

  test("webhook payload only has what the message needs", async () => {
    const { convex, bob, toolId } = await world();
    await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(2) });
    const delivery = await convex.run(async (ctx) => (await ctx.db.query("webhookDeliveries").collect())[0]);
    const payload = JSON.parse(delivery.payload);
    expect(Object.keys(payload).sort()).toEqual(["endDate", "event", "eventKey", "loanId", "recipient", "startDate", "toolName"]);
    expect(payload.recipient).toEqual({ firstName: "Alice", email: "alice@lendloop.test" });
  });
});
