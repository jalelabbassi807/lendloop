"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import { timeAgo } from "@/lib/format";
import { LoanRow } from "./LoanRow";
import { CategoryPill, Empty, ErrorText, Loading, useSubmit } from "@/components/ui";

const SECTIONS = { loans: "Loans", listings: "Listings", users: "Users", automation: "Automation" } as const;
type Section = keyof typeof SECTIONS;

export function AdminPanel() {
  const [section, setSection] = useState<Section>("loans");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {(Object.keys(SECTIONS) as Section[]).map((s) => (
          <button key={s} className={section === s ? "btn-primary" : "btn"} aria-pressed={section === s} onClick={() => setSection(s)}>
            {SECTIONS[s]}
          </button>
        ))}
      </div>
      {section === "loans" && <AllLoans />}
      {section === "listings" && <AllListings />}
      {section === "users" && <Users />}
      {section === "automation" && <Automation />}
    </div>
  );
}

function AllLoans() {
  const loans = useQuery(api.loans.listAllForAdmin);
  if (loans === undefined) return <Loading />;
  if (loans.length === 0) return <Empty>No loans yet.</Empty>;
  return (
    <ul className="space-y-3">
      {loans.map((l) => <LoanRow key={l._id} loan={l} />)}
    </ul>
  );
}

function AllListings() {
  const tools = useQuery(api.tools.list, {});
  const remove = useMutation(api.tools.remove);
  const { busy, error, run } = useSubmit();
  if (tools === undefined) return <Loading />;
  if (tools.length === 0) return <Empty>No listings.</Empty>;
  return (
    <div>
      <ErrorText error={error} />
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        {tools.map((t) => (
          <li key={t._id} className="flex items-center justify-between gap-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.name}</span>
              <CategoryPill category={t.category} />
              <span className="text-xs text-stone-500">by {t.ownerName}</span>
            </div>
            <button
              className="btn-danger"
              disabled={busy}
              onClick={() => {
                if (confirm(`Remove "${t.name}"? Pending requests and future bookings are cancelled. A loan that's already out stays.`)) {
                  void run(() => remove({ toolId: t._id }));
                }
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Users() {
  const users = useQuery(api.users.listForAdmin);
  const setTrusted = useMutation(api.users.setTrustedLender);
  const { busy, error, run } = useSubmit();
  if (users === undefined) return <Loading />;
  return (
    <div>
      <ErrorText error={error} />
      <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white">
        {users.map((u) => (
          <li key={u._id} className="flex items-center justify-between gap-3 p-3">
            <div>
              <p className="font-medium">
                {u.name} {u.role === "admin" && <span className="text-xs font-normal text-stone-500">(admin)</span>}
              </p>
              <p className="text-xs text-stone-500">{u.email ?? "no email"}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={u.trustedLender}
                disabled={busy}
                onChange={(e) => void run(() => setTrusted({ userId: u._id, trusted: e.target.checked }))}
              />
              Trusted Lender
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Automation() {
  const health = useQuery(api.automation.health);
  const retry = useMutation(api.automation.retryDelivery);
  const dismiss = useMutation(api.automation.dismissWorkflowError);
  const { busy, error, run } = useSubmit();
  if (health === undefined) return <Loading />;

  const { failedDeliveries, retryingDeliveries, failedSends, workflowErrors } = health;
  if (failedDeliveries.length + retryingDeliveries.length + failedSends.length + workflowErrors.length === 0) {
    return <Empty>Everything&apos;s fine. No failed or retrying deliveries.</Empty>;
  }

  return (
    <div className="space-y-4">
      <ErrorText error={error} />
      <Group title="Failed deliveries to n8n" items={failedDeliveries}>
        {(d) => (
          <>
            <span>
              <code className="text-xs">{d.eventKey}</code> failed {d.attempts}x: {d.lastError}
            </span>
            <button className="btn" disabled={busy} onClick={() => void run(() => retry({ deliveryId: d._id }))}>Retry</button>
          </>
        )}
      </Group>
      <Group title="Retrying" items={retryingDeliveries} border="border-amber-200">
        {(d) => (
          <span>
            <code className="text-xs">{d.eventKey}</code> attempt {d.attempts} failed ({d.lastError}), next try at{" "}
            {d.nextAttemptAt ? new Date(d.nextAttemptAt).toLocaleTimeString() : "soon"}
          </span>
        )}
      </Group>
      <Group title="Messages n8n couldn't send" items={failedSends}>
        {(e) => (
          <span>
            <code className="text-xs">{e.idempotencyKey}</code> {e.detail}, {timeAgo(e.at)}
          </span>
        )}
      </Group>
      <Group title="n8n workflow errors" items={workflowErrors}>
        {(e) => (
          <>
            <span>{e.detail} ({timeAgo(e.at)})</span>
            <button className="btn" disabled={busy} onClick={() => void run(() => dismiss({ eventId: e._id }))}>Dismiss</button>
          </>
        )}
      </Group>
    </div>
  );
}

function Group<T extends { _id: string }>(props: {
  title: string;
  items: T[];
  border?: string;
  children: (item: T) => React.ReactNode;
}) {
  if (props.items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{props.title}</h3>
      <ul className={`divide-y divide-stone-200 rounded-lg border bg-white text-sm ${props.border ?? "border-red-200"}`}>
        {props.items.map((item) => (
          <li key={item._id} className="flex items-center justify-between gap-3 p-3">
            {props.children(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}
