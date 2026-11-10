import { convexTest } from "convex-test";
import { api } from "../convex/_generated/api";
import { todayUtc } from "../convex/lib/dates";
import schema from "../convex/schema";

const modules = import.meta.glob(["../convex/**/*.ts", "../convex/**/*.js", "!../convex/**/*.d.ts"]);

export function setup() {
  const convex = convexTest(schema, modules);

  async function signIn(name: string, email: string, emailVerified = true) {
    const client = convex.withIdentity({ subject: email, issuer: "https://clerk.test", name, email, emailVerified });
    const id = await client.mutation(api.users.ensureUser, {});
    return { client, id };
  }

  return { convex, signIn };
}

export const isoDate = (days: number) => todayUtc(Date.now() + days * 86_400_000);
