"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "../../../convex/_generated/api";
import { AdminPanel } from "./AdminPanel";
import { BrowseTools } from "./BrowseTools";
import { IncomingRequests } from "./IncomingRequests";
import { MyListings } from "./MyListings";
import { MyRequests } from "./MyRequests";
import { Loading } from "@/components/ui";

const TABS = [
  { id: "browse", label: "Browse tools" },
  { id: "listings", label: "My listings" },
  { id: "requests", label: "My requests" },
  { id: "incoming", label: "Incoming requests" },
  { id: "admin", label: "Admin" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function Dashboard() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const ensureUser = useMutation(api.users.ensureUser);
  const [ready, setReady] = useState(false);
  const [syncError, setSyncError] = useState(false);
  const me = useQuery(api.users.me, ready ? {} : "skip");
  const incoming = useQuery(api.loans.incomingRequests, ready ? {} : "skip");
  const [tab, setTab] = useState<Tab>("browse");

  useEffect(() => {
    if (!isAuthenticated || ready || syncError) return;
    ensureUser()
      .then(() => setReady(true))
      .catch(() => setSyncError(true));
  }, [isAuthenticated, ready, syncError, ensureUser]);

  if (syncError || (!isLoading && !isAuthenticated) || (ready && me === null)) {
    return (
      <div className="card space-y-3 text-sm">
        <p>Couldn&apos;t load your account.</p>
        <button
          className="btn"
          onClick={() => {
            setReady(false);
            setSyncError(false);
          }}
        >
          Try again
        </button>
      </div>
    );
  }
  if (!ready || !me) return <Loading />;

  const pending = incoming?.filter((l) => l.status === "pending" && !l.expired).length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hi, {me.name}</h1>
        <p className="text-sm text-stone-500">
          {me.role === "admin" ? "Admin" : "Neighbor"}
          {me.trustedLender && ", Trusted Lender"}
        </p>
      </div>

      <nav className="-mx-4 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-stone-200 px-4 pb-px">
        {TABS.filter((t) => t.id !== "admin" || me.role === "admin").map((t) => (
          <button
            key={t.id}
            aria-current={tab === t.id ? "page" : undefined}
            onClick={() => setTab(t.id)}
            className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.id ? "border-emerald-600 text-emerald-700" : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {t.label}
            {t.id === "incoming" && pending > 0 && (
              <span className="ml-1.5 rounded-full bg-emerald-600 px-1.5 text-xs text-white">{pending}</span>
            )}
          </button>
        ))}
      </nav>

      {tab === "browse" && <BrowseTools />}
      {tab === "listings" && <MyListings />}
      {tab === "requests" && <MyRequests />}
      {tab === "incoming" && <IncomingRequests />}
      {tab === "admin" && me.role === "admin" && <AdminPanel />}
    </div>
  );
}
