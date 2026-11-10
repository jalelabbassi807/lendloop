"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MAX_LOAN_DAYS, todayUtc } from "../../../convex/lib/dates";
import { CATEGORY_LABELS, CONDITION_LABELS, type Category } from "@/lib/format";
import { AvailabilityPill, CategoryPill, Empty, ErrorText, Loading, TrustedBadge, useSubmit } from "@/components/ui";

export function BrowseTools() {
  const [category, setCategory] = useState<Category | null>(null);
  const tools = useQuery(api.tools.list, category ? { category } : {});
  const [requesting, setRequesting] = useState<Id<"tools"> | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip active={!category} onClick={() => setCategory(null)}>All</Chip>
        {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABELS[c]}
          </Chip>
        ))}
      </div>

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>{category ? "Nothing in this category yet." : "Nothing listed yet."}</Empty>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t._id} className="card space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-medium">{t.name}</h3>
                  <p className="text-xs text-stone-500">
                    {CONDITION_LABELS[t.condition]} condition, {t.isMine ? "yours" : `lent by ${t.ownerName}`}
                  </p>
                </div>
                <AvailabilityPill availability={t.availability} />
              </div>
              {t.description && <p className="text-sm text-stone-700">{t.description}</p>}
              <div className="flex flex-wrap items-center gap-2">
                <CategoryPill category={t.category} />
                {t.ownerTrusted && <TrustedBadge />}
              </div>
              {!t.isMine &&
                (requesting === t._id ? (
                  <RequestForm toolId={t._id} onClose={() => setRequesting(null)} />
                ) : (
                  <button className="btn" onClick={() => setRequesting(t._id)}>
                    Request to borrow
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const addDays = (iso: string, days: number) => todayUtc(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000);

function Chip(props: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.active}
      className={`rounded-full border px-3 py-1 text-sm ${
        props.active ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-stone-300 bg-white text-stone-600 hover:bg-stone-100"
      }`}
    >
      {props.children}
    </button>
  );
}

function RequestForm({ toolId, onClose }: { toolId: Id<"tools">; onClose: () => void }) {
  const request = useMutation(api.loans.request);
  const today = todayUtc();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const { busy, error, run } = useSubmit();
  const [sent, setSent] = useState(false);

  if (sent) return <p className="text-sm text-emerald-700">Request sent. You can follow it under My requests.</p>;

  return (
    <form
      className="space-y-2 rounded-md bg-stone-50 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => request({ toolId, startDate: start, endDate: end }))) setSent(true);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">From</span>
          <input
            type="date"
            className="input"
            min={today}
            value={start}
            required
            onChange={(e) => {
              setStart(e.target.value);
              if (e.target.value > end) setEnd(e.target.value);
            }}
          />
        </label>
        <label>
          <span className="label">To</span>
          <input
            type="date"
            className="input"
            min={start}
            max={addDays(start, MAX_LOAN_DAYS - 1)}
            value={end}
            required
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Sending..." : "Send request"}</button>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}
