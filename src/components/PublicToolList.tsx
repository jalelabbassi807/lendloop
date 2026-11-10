"use client";

import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { CategoryPill, Empty, Loading } from "@/components/ui";

export function PublicToolList() {
  const tools = useQuery(api.tools.listPublic);

  if (tools === undefined) return <Loading />;
  if (tools.length === 0) return <Empty>Nothing available right now. Sign in to list something of yours.</Empty>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tools.map((t) => (
        <li key={t._id} className="card flex items-center justify-between gap-2">
          <span className="font-medium">{t.name}</span>
          <CategoryPill category={t.category} />
        </li>
      ))}
    </ul>
  );
}
