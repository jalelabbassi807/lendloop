import { httpRouter } from "convex/server";
import { ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verify } from "./lib/hmac";
import { todayUtc } from "./lib/dates";
import { AUTOMATION_KINDS } from "./schema";

const http = httpRouter();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function isSigned(request: Request, rawBody: string) {
  const result = await verify(
    process.env.N8N_TO_CONVEX_SECRET,
    request.headers.get(TIMESTAMP_HEADER),
    request.headers.get(SIGNATURE_HEADER),
    rawBody,
  );
  if (!result.ok) console.warn(`rejected ${new URL(request.url).pathname}: ${result.reason}`);
  return result.ok;
}

http.route({
  path: "/n8n/overdue-loans",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await isSigned(request, ""))) return json({ error: "unauthorized" }, 401);
    const loans = await ctx.runQuery(internal.automation.overdueLoans, { today: todayUtc() });
    return json({ loans });
  }),
});

http.route({
  path: "/n8n/automation-result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const raw = await request.text();
    if (!(await isSigned(request, raw))) return json({ error: "unauthorized" }, 401);

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: "invalid JSON" }, 400);
    }
    const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : undefined);
    const kind = AUTOMATION_KINDS.find((k) => k === body.kind);
    const status = body.status === "sent" || body.status === "failed" ? body.status : undefined;
    const idempotencyKey = str("idempotencyKey");
    if (!kind || !status || !idempotencyKey) {
      return json({ error: "idempotencyKey, kind and status are required" }, 400);
    }

    try {
      const result = await ctx.runMutation(internal.automation.recordResult, {
        idempotencyKey,
        kind,
        status,
        loanId: str("loanId"),
        reminderDate: str("reminderDate"),
        detail: str("detail"),
      });
      return json(result);
    } catch (e) {
      if (e instanceof ConvexError) return json({ error: String(e.data) }, 422);
      throw e;
    }
  }),
});

export default http;
