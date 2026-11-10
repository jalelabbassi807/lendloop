// Builds the "LendLoop SMTP" credential from env vars, for `n8n import:credentials`.
// n8n encrypts it on import, so the password only ever lives in n8n/.env and n8n.
import { writeFileSync } from "node:fs";

const { SMTP_HOST, SMTP_PORT = "587", SMTP_USER = "", SMTP_PASSWORD = "", SMTP_SECURE = "false" } = process.env;
if (!SMTP_HOST) throw new Error("SMTP_HOST is not set");

const credential = {
  id: "Rk2mTq8vNs4LpX0a",
  name: "LendLoop SMTP",
  type: "smtp",
  data: {
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    user: SMTP_USER,
    password: SMTP_PASSWORD,
    secure: SMTP_SECURE === "true",
  },
};

writeFileSync(process.argv[2], JSON.stringify([credential]));
