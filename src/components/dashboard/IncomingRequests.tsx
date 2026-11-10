"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { LoanRow, type Loan } from "./LoanRow";
import { Empty, ErrorText, Loading, useSubmit } from "@/components/ui";

export function IncomingRequests() {
  const loans = useQuery(api.loans.incomingRequests);
  if (loans === undefined) return <Loading />;
  if (loans.length === 0) return <Empty>No one has asked to borrow your tools yet.</Empty>;
  return (
    <ul className="space-y-3">
      {loans.map((l) => (
        <LoanRow
          key={l._id}
          loan={l}
          actions={(l.status === "pending" || l.status === "approved") && <Actions loan={l} />}
        />
      ))}
    </ul>
  );
}

function Actions({ loan }: { loan: Loan }) {
  const approve = useMutation(api.loans.approve);
  const decline = useMutation(api.loans.decline);
  const markReturned = useMutation(api.loans.markReturned);
  const { busy, error, run } = useSubmit();
  const loanId = loan._id;

  return (
    <div className="text-right">
      <div className="flex gap-2">
        {loan.status === "pending" && !loan.expired && (
          <button className="btn-primary" disabled={busy} onClick={() => void run(() => approve({ loanId }))}>Approve</button>
        )}
        {loan.status === "pending" && (
          <button className="btn" disabled={busy} onClick={() => void run(() => decline({ loanId }))}>Decline</button>
        )}
        {loan.status === "approved" && (
          <button className="btn" disabled={busy} onClick={() => void run(() => markReturned({ loanId }))}>Mark returned</button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}
