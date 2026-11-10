"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LoanRow } from "./LoanRow";
import { Empty, ErrorText, Loading, useSubmit } from "@/components/ui";

export function MyRequests() {
  const loans = useQuery(api.loans.myRequests);
  if (loans === undefined) return <Loading />;
  if (loans.length === 0) return <Empty>You haven&apos;t asked to borrow anything yet.</Empty>;
  return (
    <ul className="space-y-3">
      {loans.map((l) => (
        <LoanRow key={l._id} loan={l} actions={l.status === "pending" && <CancelButton loanId={l._id} />} />
      ))}
    </ul>
  );
}

function CancelButton({ loanId }: { loanId: Id<"loans"> }) {
  const cancel = useMutation(api.loans.cancel);
  const { busy, error, run } = useSubmit();
  return (
    <div>
      <button className="btn" disabled={busy} onClick={() => void run(() => cancel({ loanId }))}>Cancel request</button>
      <ErrorText error={error} />
    </div>
  );
}
