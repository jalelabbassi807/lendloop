// Signature = hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)), timestamp in
// unix seconds. Requests more than 5 minutes off are rejected to limit replays.

export const SIGNATURE_HEADER = "X-LendLoop-Signature";
export const TIMESTAMP_HEADER = "X-LendLoop-Timestamp";
const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

export async function sign(secret: string, timestamp: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${rawBody}`));
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(
  secret: string | undefined,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: "secret not configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };

  const expected = await sign(secret, timestamp, rawBody);
  return timingSafeEqual(expected, signature.toLowerCase()) ? { ok: true } : { ok: false, reason: "bad signature" };
}
