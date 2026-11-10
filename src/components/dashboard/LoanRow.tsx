"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";
import { formatDate } from "@/lib/format";
import { ActivityLine, StatusPill, TrustedBadge } from "@/components/ui";

export type Loan = FunctionReturnType<typeof api.loans.myRequests>[number];

function people(loan: Loan) {
  if (loan.borrowerName && loan.lenderName) return `${loan.borrowerName} from ${loan.lenderName}`;
  if (loan.lenderName) return `from ${loan.lenderName}`;
  return loan.status === "pending" ? `requested by ${loan.borrowerName}` : `lent to ${loan.borrowerName}`;
}

export function LoanRow({ loan, actions }: { loan: Loan; actions?: React.ReactNode }) {
  return (
    <li className="card flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium">{loan.toolName}</h3>
          {loan.expired ? <StatusPill status="expired" /> : <StatusPill status={loan.status} />}
          {loan.overdue && <StatusPill status="overdue" />}
          {loan.lenderName && loan.lenderTrusted && <TrustedBadge />}
        </div>
        <p className="mt-1 text-sm text-stone-600">
          {formatDate(loan.startDate)} to {formatDate(loan.endDate)}, {people(loan)}
        </p>
        <ActivityLine activity={loan.activity} />
      </div>
      {actions}
    </li>
  );
}
