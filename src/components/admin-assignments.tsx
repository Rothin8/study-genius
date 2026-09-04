import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList } from "lucide-react";

type Row = {
  id: string;
  title: string;
  due_at: string | null;
  class_name: string;
  teacher_name: string | null;
  documents_count: number;
  students_count: number;
  done_count: number;
  in_progress_count: number;
};

/** Platform-wide assignment report; the RPC itself rejects non-admins. */
export function AdminAssignments() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_assignments");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  return (
    <section className="glass mt-6 rounded-3xl p-5">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <ClipboardList className="size-4 text-primary" /> Assignments across all classes
      </h2>

      {isLoading && <Skeleton className="mt-4 h-24 w-full rounded-xl" />}
      {error && (
        <p className="mt-3 text-sm text-destructive">
          {error instanceof Error ? error.message : "Could not load assignments."}
        </p>
      )}
      {!isLoading && !error && (data?.length ?? 0) === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No assignments have been posted yet.</p>
      )}

      {(data?.length ?? 0) > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground uppercase">
              <tr>
                <th className="pb-2">Assignment</th>
                <th className="pb-2">Class</th>
                <th className="pb-2">Teacher</th>
                <th className="pb-2">Due</th>
                <th className="pb-2">Docs</th>
                <th className="pb-2">Completion</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="py-2.5 pr-4 font-medium">{row.title}</td>
                  <td className="py-2.5 pr-4">{row.class_name}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {row.teacher_name ?? "Unknown"}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">
                    {row.due_at ? new Date(row.due_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="py-2.5 pr-4">{row.documents_count}</td>
                  <td className="py-2.5">
                    <Badge variant="secondary">
                      {row.done_count}/{row.students_count} done · {row.in_progress_count} active
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
