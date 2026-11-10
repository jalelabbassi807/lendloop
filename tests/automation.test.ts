import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, sign, verify } from "../convex/lib/hmac";
import { isoDate, setup } from "./setup";

const IN_SECRET = "n8n-to-convex-test-secret";
const OUT_SECRET = "convex-to-n8n-test-secret";

beforeEach(() => {
  process.env.N8N_TO_CONVEX_SECRET = IN_SECRET;
  process.env.CONVEX_TO_N8N_SECRET = OUT_SECRET;
  process.env.N8N_REQUEST_WEBHOOK_URL = "https://n8n.test/webhook/lendloop-request";
  process.env.ADMIN_EMAILS = "admin@lendloop.test";
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.N8N_REQUEST_WEBHOOK_URL;
  delete process.env.ADMIN_EMAILS;
});

async function signed(body: string, ts = Math.floor(Date.now() / 1000)) {
  const timestamp = String(ts);
  return {
    "Content-Type": "application/json",
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: await sign(IN_SECRET, timestamp, body),
  };
}

// Alice lent Bob her ladder, due back two days ago
async function overdue() {
  const app = setup();
  const alice = await app.signIn("Alice", "alice@lendloop.test");
  const bob = await app.signIn("Bob Jones", "bob@lendloop.test");
  const toolId = await alice.client.mutation(api.tools.create, {
    name: "Ladder",
    category: "hand_tools",
    condition: "good",
    description: "",
  });
  const loanId = await app.convex.run((ctx) =>
    ctx.db.insert("loans", {
      toolId,
      toolName: "Ladder",
      lenderId: alice.id as Id<"users">,
      borrowerId: bob.id as Id<"users">,
      startDate: isoDate(-5),
      endDate: isoDate(-2),
      status: "approved",
    }),
  );
  const post = async (data: object) => {
    const body = JSON.stringify(data);
    return app.convex.fetch("/n8n/automation-result", { method: "POST", body, headers: await signed(body) });
  };
  return { ...app, loanId, post };
}

describe("hmac", () => {
  test("rejects tampering, wrong secrets and old timestamps", async () => {
    const now = 1_800_000_000;
    const sig = await sign("s", String(now), "body");
    expect(await verify("s", String(now), sig, "body", now)).toEqual({ ok: true });
    expect((await verify("s", String(now), sig, "body2", now)).ok).toBe(false);
    expect((await verify("other", String(now), sig, "body", now)).ok).toBe(false);
    expect((await verify("s", String(now), sig, "body", now + 301)).ok).toBe(false);
    expect((await verify(undefined, String(now), sig, "body", now)).ok).toBe(false);
  });
});

describe("endpoints n8n calls", () => {
  test("overdue-loans needs a fresh signature", async () => {
    const { convex } = await overdue();
    expect((await convex.fetch("/n8n/overdue-loans")).status).toBe(401);
    const old = await signed("", Math.floor(Date.now() / 1000) - 3600);
    expect((await convex.fetch("/n8n/overdue-loans", { headers: old })).status).toBe(401);
  });

  test("overdue reminder round trip", async () => {
    const { convex, loanId, post } = await overdue();

    const res = await convex.fetch("/n8n/overdue-loans", { headers: await signed("") });
    expect(res.status).toBe(200);
    const { loans } = await res.json();
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ loanId, daysOverdue: 2, borrower: { firstName: "Bob", email: "bob@lendloop.test" } });

    const result = { kind: "overdue_reminder", loanId, reminderDate: loans[0].reminderDate, idempotencyKey: loans[0].idempotencyKey };
    expect(await (await post({ ...result, status: "failed" })).json()).toMatchObject({ duplicate: false });
    expect((await (await convex.fetch("/n8n/overdue-loans", { headers: await signed("") })).json()).loans).toHaveLength(1);

    expect(await (await post({ ...result, status: "sent" })).json()).toMatchObject({ duplicate: false });
    expect(await (await post({ ...result, status: "sent" })).json()).toMatchObject({ duplicate: true });
    const events = await convex.run((ctx) => ctx.db.query("automationEvents").collect());
    expect(events.map((e) => e.status)).toEqual(["sent"]);

    expect((await (await convex.fetch("/n8n/overdue-loans", { headers: await signed("") })).json()).loans).toHaveLength(0);
  });

  test("keys have to match the loan", async () => {
    const { loanId, post } = await overdue();
    const reminder = await post({ kind: "overdue_reminder", status: "sent", loanId, reminderDate: isoDate(0), idempotencyKey: "overdue:other" });
    expect(reminder.status).toBe(422);
    const wrongEvent = await post({ kind: "request_notification", status: "sent", loanId, idempotencyKey: `loan:${loanId}:toString` });
    expect(wrongEvent.status).toBe(422);
    const ok = await post({ kind: "request_notification", status: "sent", loanId, idempotencyKey: `loan:${loanId}:approved` });
    expect(ok.status).toBe(200);
  });

  test("bad requests", async () => {
    const { convex, loanId } = await overdue();
    const body = JSON.stringify({ kind: "workflow_error", status: "failed", idempotencyKey: "err:1", loanId });
    const tampered = await convex.fetch("/n8n/automation-result", {
      method: "POST",
      body: body.replace("failed", "sent"),
      headers: await signed(body),
    });
    expect(tampered.status).toBe(401);

    const notJson = await convex.fetch("/n8n/automation-result", { method: "POST", body: "{nope", headers: await signed("{nope") });
    expect(notJson.status).toBe(400);
  });

  test("only admins can dismiss errors", async () => {
    const { convex, signIn, post } = await overdue();
    await post({ kind: "workflow_error", status: "failed", idempotencyKey: "n8n-error:wf:1", detail: "boom" });
    const [error] = await convex.run((ctx) => ctx.db.query("automationEvents").collect());

    const bob = await signIn("Bob Jones", "bob@lendloop.test");
    await expect(bob.client.mutation(api.automation.dismissWorkflowError, { eventId: error._id })).rejects.toThrow(/Admins only/);
    const admin = await signIn("Ada", "admin@lendloop.test");
    expect((await admin.client.query(api.automation.health, {})).workflowErrors).toHaveLength(1);
    await admin.client.mutation(api.automation.dismissWorkflowError, { eventId: error._id });
    expect((await admin.client.query(api.automation.health, {})).workflowErrors).toHaveLength(0);
  });
});

describe("sending events to n8n", () => {
  async function queued() {
    const app = setup();
    const alice = await app.signIn("Alice", "alice@lendloop.test");
    const bob = await app.signIn("Bob", "bob@lendloop.test");
    const toolId = await alice.client.mutation(api.tools.create, {
      name: "Tent",
      category: "camping",
      condition: "good",
      description: "",
    });
    await bob.client.mutation(api.loans.request, { toolId, startDate: isoDate(1), endDate: isoDate(2) });
    const delivery = await app.convex.run(async (ctx) => (await ctx.db.query("webhookDeliveries").collect())[0]);
    const deliver = () => app.convex.action(internal.notifications.deliver, { deliveryId: delivery._id });
    const current = () => app.convex.run((ctx) => ctx.db.get(delivery._id));
    return { ...app, deliveryId: delivery._id, deliver, current };
  }
  const respond = (status: number) => vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));

  test("signs the request", async () => {
    const { deliver, current } = await queued();
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await deliver();
    expect((await current())?.status).toBe("delivered");

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(await verify(OUT_SECRET, headers[TIMESTAMP_HEADER], headers[SIGNATURE_HEADER], init.body as string)).toEqual({ ok: true });
    expect(headers["Idempotency-Key"]).toMatch(/^loan:.+:request_created$/);
  });

  test("retries, then gives up", async () => {
    const { deliver, current } = await queued();
    respond(503);
    await deliver();
    const first = await current();
    expect(first).toMatchObject({ status: "pending", attempts: 1, lastError: "HTTP 503" });
    expect(first?.nextAttemptAt).toBeGreaterThan(Date.now());

    for (let i = 0; i < 4; i++) await deliver();
    expect(await current()).toMatchObject({ status: "failed", attempts: 5 });
  });

  test("a 404 (n8n restarting) is retried, a 401 isn't", async () => {
    const a = await queued();
    respond(404);
    await a.deliver();
    expect(await a.current()).toMatchObject({ status: "pending", attempts: 1 });

    const b = await queued();
    respond(401);
    await b.deliver();
    expect(await b.current()).toMatchObject({ status: "failed", attempts: 1 });
  });

  test("admin retry puts a failed delivery back in the queue", async () => {
    const { signIn, deliveryId, deliver, current } = await queued();
    respond(401);
    await deliver();

    const bob = await signIn("Bob", "bob@lendloop.test");
    await expect(bob.client.mutation(api.automation.retryDelivery, { deliveryId })).rejects.toThrow(/Admins only/);
    const admin = await signIn("Ada", "admin@lendloop.test");
    await admin.client.mutation(api.automation.retryDelivery, { deliveryId });
    expect(await current()).toMatchObject({ status: "pending", attempts: 0 });
  });
});
