"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { CATEGORY_LABELS, CONDITION_LABELS, type Category, type Condition } from "@/lib/format";
import { AvailabilityPill, CategoryPill, Empty, ErrorText, Loading, useSubmit } from "@/components/ui";

type Fields = { name: string; category: Category; condition: Condition; description: string };
const blank: Fields = { name: "", category: "power_tools", condition: "good", description: "" };

export function MyListings() {
  const tools = useQuery(api.tools.myListings);
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Id<"tools"> | null>(null);

  return (
    <div className="space-y-4">
      {adding ? (
        <div className="card">
          <h3 className="mb-3 font-medium">List a tool</h3>
          <ToolForm initial={blank} submitLabel="List tool" onSubmit={create} onClose={() => setAdding(false)} />
        </div>
      ) : (
        <button className="btn-primary" onClick={() => setAdding(true)}>+ List a tool</button>
      )}

      {tools === undefined ? (
        <Loading />
      ) : tools.length === 0 ? (
        <Empty>You haven&apos;t listed anything yet.</Empty>
      ) : (
        <ul className="space-y-3">
          {tools.map(({ _id, availability, ...fields }) =>
            editing === _id ? (
              <li key={_id} className="card">
                <ToolForm
                  initial={fields}
                  submitLabel="Save"
                  onSubmit={(f) => update({ toolId: _id, ...f })}
                  onClose={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={_id} className="card flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium">{fields.name}</h3>
                    <CategoryPill category={fields.category} />
                    <AvailabilityPill availability={availability} />
                  </div>
                  <p className="text-xs text-stone-500">{CONDITION_LABELS[fields.condition]} condition</p>
                  {fields.description && <p className="text-sm text-stone-700">{fields.description}</p>}
                </div>
                <div className="flex gap-2">
                  <button className="btn" onClick={() => setEditing(_id)}>Edit</button>
                  <DeleteButton toolId={_id} />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function DeleteButton({ toolId }: { toolId: Id<"tools"> }) {
  const remove = useMutation(api.tools.remove);
  const { busy, error, run } = useSubmit();
  return (
    <div className="text-right">
      <button
        className="btn-danger"
        disabled={busy}
        onClick={() => {
          if (confirm("Delete this listing? Any pending requests for it will be cancelled.")) void run(() => remove({ toolId }));
        }}
      >
        Delete
      </button>
      <ErrorText error={error} />
    </div>
  );
}

function ToolForm(props: {
  initial: Fields;
  submitLabel: string;
  onSubmit: (fields: Fields) => Promise<unknown>;
  onClose: () => void;
}) {
  const [f, setF] = useState(props.initial);
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) => setF((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => props.onSubmit(f))) props.onClose();
      }}
    >
      <label className="block">
        <span className="label">Name</span>
        <input className="input" value={f.name} maxLength={80} required onChange={(e) => set("name", e.target.value)} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="label">Category</span>
          <select className="input" value={f.category} onChange={(e) => set("category", e.target.value as Category)}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">Condition</span>
          <select className="input" value={f.condition} onChange={(e) => set("condition", e.target.value as Condition)}>
            {Object.entries(CONDITION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="label">Short description</span>
        <textarea
          className="input"
          rows={2}
          maxLength={500}
          value={f.description}
          placeholder="Anything a borrower should know"
          onChange={(e) => set("description", e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? "Saving..." : props.submitLabel}</button>
        <button type="button" className="btn" onClick={props.onClose}>Cancel</button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}
