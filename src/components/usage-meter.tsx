import { useUsage } from "@/hooks/use-usage";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

function Bar({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>
          {used}/{limit}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accent">
        <div
          className={pct >= 100 ? "h-full bg-destructive" : "h-full bg-primary"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/** Compact plan + monthly usage summary for the app sidebar. */
export function UsageMeter() {
  const { data, isLoading } = useUsage();

  if (isLoading) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (!data) return null;

  return (
    <div className="hidden space-y-2 rounded-xl border border-border p-3 md:block">
      <div className="flex items-center justify-between">
        <span className="text-[11px] tracking-wide text-muted-foreground uppercase">This month</span>
        <Badge variant={data.plan === "pro" ? "default" : "secondary"}>{data.plan}</Badge>
      </div>
      <Bar label="Documents" used={data.documents} limit={data.limits.documents} />
      <Bar label="Pages" used={data.pages} limit={data.limits.pages} />
      <Bar label="Questions" used={data.questions} limit={data.limits.questions} />
    </div>
  );
}
