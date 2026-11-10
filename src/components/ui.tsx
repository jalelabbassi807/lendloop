"use client";

import { useState } from "react";
import { CATEGORY_LABELS, errorMessage, formatDate, timeAgo, type Category } from "@/lib/format";
import { todayUtc } from "../../convex/lib/dates";

export function TrustedBadge() {
  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="Verified by an admin">
      Trusted Lender
    </span>
  );
}

export function CategoryPill({ category }: { category: Category }) {
  return <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{CATEGORY_LABELS[category]}</span>;
}

const pillColors: Record<string, string> = {
  pending: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  available: "bg-emerald-100 text-emerald-800",
  returned: "bg-violet-100 text-violet-800",
  on_loan: "bg-orange-100 text-orange-800",
  overdue: "bg-red-100 text-red-800",
  declined: "bg-stone-200 text-stone-600",
  cancelled: "bg-stone-200 text-stone-600",
  expired: "bg-stone-200 text-stone-600",
};

export function StatusPill({ status, label }: { status: string; label?: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${pillColors[status] ?? "bg-stone-100"}`}>
      {label ?? status.replace("_", " ")}
    </span>
  );
}

export function AvailabilityPill({ availability }: { availability: { status: string; until: string | null } }) {
  if (!availability.until) return <StatusPill status="available" label="Available" />;
  const label = availability.until < todayUtc() ? "On loan, overdue" : `On loan until ${formatDate(availability.until)}`;
  return <StatusPill status="on_loan" label={label} />;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="card text-sm text-stone-500">{children}</p>;
}

export function Loading() {
  return <p className="text-sm text-stone-500">Loading...</p>;
}

export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null;
}

export function ActivityLine({ activity }: { activity: { kind: string; status: string; at: number }[] }) {
  const latest = activity[0];
  if (!latest) return null;
  const what = latest.kind === "overdue_reminder" ? "Reminder" : "Notification";
  return (
    <p className="mt-1 text-xs text-stone-500">
      {what} {latest.status === "sent" ? "sent" : "failed"} {timeAgo(latest.at)}
    </p>
  );
}
