import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { useRoles } from "@/hooks/use-role";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({
    meta: [
      { title: "Platform Analytics — Solution.AI" },
      {
        name: "description",
        content:
          "Super Admin analytics for Solution.AI: users, documents, questions asked and 30-day usage trends.",
      },
      { property: "og:title", content: "Platform Analytics — Solution.AI" },
      { property: "og:description", content: "Usage and growth across the platform." },
    ],
  }),
  component: AdminPage,
});

type Stats = {
  users: number;
  teachers: number;
  students: number;
  documents: number;
  chunks: number;
  questions: number;
  classes: number;
  failed_documents: number;
  daily: { day: string; questions: number; documents: number }[];
  top_subjects: { subject: string; count: number }[];
};

function AdminPage() {
  const { isAdmin, loading: rolesLoading } = useRoles();

  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-stats"],
    enabled: isAdmin,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("platform_stats");
      if (error) throw error;
      return data as unknown as Stats;
    },
  });

  if (rolesLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <ShieldAlert className="mx-auto size-8 text-destructive" />
        <h1 className="mt-4 text-2xl font-semibold">Admins only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This dashboard is restricted to Super Admins.
        </p>
      </div>
    );
  }

  const cards = data
    ? [
        { label: "Users", value: data.users },
        { label: "Teachers", value: data.teachers },
        { label: "Students", value: data.students },
        { label: "Classes", value: data.classes },
        { label: "Documents", value: data.documents },
        { label: "Indexed passages", value: data.chunks },
        { label: "Questions asked", value: data.questions },
        { label: "Failed uploads", value: data.failed_documents },
      ]
    : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">Platform Analytics</h1>
        <p className="mt-2 text-muted-foreground">
          Live usage across Solution.AI — accounts, knowledge base size and question volume.
        </p>
      </header>

      {error && (
        <p className="mt-6 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load analytics."}
        </p>
      )}

      {isLoading && <Skeleton className="mt-8 h-32 w-full rounded-2xl" />}

      {data && (
        <>
          <section className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className="glass rounded-2xl p-4">
                <p className="text-xs tracking-wide text-muted-foreground uppercase">
                  {card.label}
                </p>
                <p className="mt-1 text-2xl font-semibold">{card.value.toLocaleString()}</p>
              </div>
            ))}
          </section>

          <section className="glass mt-6 rounded-3xl p-5">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Last 30 days
            </h2>
            <div className="mt-4 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.daily}>
                  <defs>
                    <linearGradient id="q" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeOpacity={0.1} vertical={false} />
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v: string) => v.slice(5)}
                    fontSize={11}
                    stroke="currentColor"
                    opacity={0.5}
                  />
                  <YAxis fontSize={11} stroke="currentColor" opacity={0.5} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="questions"
                    stroke="var(--primary)"
                    fill="url(#q)"
                    name="Questions"
                  />
                  <Area
                    type="monotone"
                    dataKey="documents"
                    stroke="var(--muted-foreground)"
                    fill="transparent"
                    name="Documents"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="glass mt-6 rounded-3xl p-5">
            <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Top subjects
            </h2>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.top_subjects}>
                  <CartesianGrid strokeOpacity={0.1} vertical={false} />
                  <XAxis dataKey="subject" fontSize={11} stroke="currentColor" opacity={0.5} />
                  <YAxis fontSize={11} stroke="currentColor" opacity={0.5} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="var(--primary)" radius={[6, 6, 0, 0]} name="Docs" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
