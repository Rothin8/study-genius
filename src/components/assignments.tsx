import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { openStoredDocument } from "@/lib/open-document";
import { ClipboardList, FileText, Loader2, Plus, Trash2 } from "lucide-react";

type Assignment = {
  id: string;
  class_id: string;
  title: string;
  instructions: string | null;
  due_at: string | null;
};

type AssignmentDoc = { assignment_id: string; document_id: string; documents: { file_name: string } | null };

function formatDue(due: string | null) {
  if (!due) return "No due date";
  return `Due ${new Date(due).toLocaleDateString()}`;
}

function useAssignmentDocs(assignmentIds: string[]) {
  return useQuery({
    queryKey: ["assignment-documents", assignmentIds.join(",")],
    enabled: assignmentIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignment_documents")
        .select("assignment_id, document_id, documents(file_name)")
        .in("assignment_id", assignmentIds);
      if (error) throw error;
      return (data ?? []) as unknown as AssignmentDoc[];
    },
  });
}

/** Teacher-facing: create assignments for a class, attach documents, watch progress. */
export function TeacherAssignments({ classId }: { classId: string }) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["assignments", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select("id, class_id, title, instructions, due_at")
        .eq("class_id", classId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Assignment[];
    },
  });

  const ids = (assignments ?? []).map((a) => a.id);
  const { data: docs } = useAssignmentDocs(ids);

  const { data: progress } = useQuery({
    queryKey: ["assignment-progress", classId, ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignment_progress")
        .select("assignment_id, status")
        .in("assignment_id", ids);
      if (error) throw error;
      return data as { assignment_id: string; status: string }[];
    },
  });

  const { data: shared } = useQuery({
    queryKey: ["class-shareable-documents", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, status")
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; file_name: string; status: string }[];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("class_assignments").insert({
        class_id: classId,
        created_by: user!.id,
        title: title.trim(),
        instructions: instructions.trim() || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTitle("");
      setInstructions("");
      setDueAt("");
      toast.success("Assignment posted to the class.");
      queryClient.invalidateQueries({ queryKey: ["assignments", classId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not post."),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("class_assignments").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assignment deleted.");
      queryClient.invalidateQueries({ queryKey: ["assignments", classId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed."),
  });

  const attach = useMutation({
    mutationFn: async ({
      assignmentId,
      documentId,
      on,
    }: {
      assignmentId: string;
      documentId: string;
      on: boolean;
    }) => {
      if (on) {
        const { error } = await supabase
          .from("assignment_documents")
          .insert({ assignment_id: assignmentId, document_id: documentId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("assignment_documents")
          .delete()
          .eq("assignment_id", assignmentId)
          .eq("document_id", documentId);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assignment-documents"] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed."),
  });

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Plus className="size-4 text-primary" /> New assignment
        </h3>
        <div className="mt-3 space-y-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title, e.g. Read chapter 4 and answer the quiz"
          />
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Instructions (optional)"
            rows={3}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              aria-label="Due date"
              className="sm:max-w-48"
            />
            <Button
              disabled={!title.trim() || create.isPending}
              onClick={() => create.mutate()}
              className="sm:ml-auto"
            >
              {create.isPending && <Loader2 className="size-4 animate-spin" />}
              Post assignment
            </Button>
          </div>
        </div>
      </div>

      {isLoading && <Skeleton className="h-20 w-full rounded-xl" />}
      {!isLoading && (assignments?.length ?? 0) === 0 && (
        <p className="text-sm text-muted-foreground">
          No assignments yet. Post one above and your students will see it on their Classes page.
        </p>
      )}

      {assignments?.map((assignment) => {
        const attached = (docs ?? []).filter((d) => d.assignment_id === assignment.id);
        const rows = (progress ?? []).filter((p) => p.assignment_id === assignment.id);
        const done = rows.filter((r) => r.status === "done").length;
        const active = rows.filter((r) => r.status === "in_progress").length;

        return (
          <article key={assignment.id} className="rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ClipboardList className="size-4 text-primary" />
              <p className="min-w-0 flex-1 font-medium">{assignment.title}</p>
              <Badge variant="secondary">{formatDue(assignment.due_at)}</Badge>
              <Badge variant="secondary">
                {done} done · {active} in progress
              </Badge>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${assignment.title}`}
                onClick={() => remove.mutate(assignment.id)}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            {assignment.instructions && (
              <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                {assignment.instructions}
              </p>
            )}

            <div className="mt-3">
              <p className="text-xs text-muted-foreground uppercase">Attached documents</p>
              <ul className="mt-2 space-y-2">
                {(shared ?? []).map((doc) => {
                  const on = attached.some((a) => a.document_id === doc.id);
                  return (
                    <li key={doc.id} className="flex items-center gap-3 text-sm">
                      <FileText className="size-4 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{doc.file_name}</span>
                      <Button
                        size="sm"
                        variant={on ? "ghost" : "secondary"}
                        onClick={() =>
                          attach.mutate({
                            assignmentId: assignment.id,
                            documentId: doc.id,
                            on: !on,
                          })
                        }
                      >
                        {on ? "Remove" : "Attach"}
                      </Button>
                    </li>
                  );
                })}
                {(shared?.length ?? 0) === 0 && (
                  <li className="text-sm text-muted-foreground">
                    Index a document in My Documents to attach it here.
                  </li>
                )}
              </ul>
            </div>
          </article>
        );
      })}
    </div>
  );
}

/** Student-facing: assignments across joined classes, with progress they control. */
export function StudentAssignments() {
  const queryClient = useQueryClient();
  const { user } = useSession();

  const { data: assignments, isLoading } = useQuery({
    queryKey: ["my-assignments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select("id, class_id, title, instructions, due_at, classes(name)")
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as unknown as (Assignment & { classes: { name: string } | null })[];
    },
  });

  const ids = (assignments ?? []).map((a) => a.id);
  const { data: docs } = useAssignmentDocs(ids);

  const { data: progress } = useQuery({
    queryKey: ["my-assignment-progress"],
    enabled: Boolean(user?.id) && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("assignment_progress")
        .select("assignment_id, status")
        .eq("student_id", user!.id);
      if (error) throw error;
      return data as { assignment_id: string; status: string }[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ assignmentId, status }: { assignmentId: string; status: string }) => {
      const { error } = await supabase
        .from("assignment_progress")
        .upsert(
          { assignment_id: assignmentId, student_id: user!.id, status },
          { onConflict: "assignment_id,student_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-assignment-progress"] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not update."),
  });

  if (isLoading) return <Skeleton className="h-20 w-full rounded-2xl" />;
  if ((assignments?.length ?? 0) === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No assignments yet — they appear here once a teacher posts one in a class you've joined.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {assignments?.map((assignment) => {
        const status =
          (progress ?? []).find((p) => p.assignment_id === assignment.id)?.status ?? "not_started";
        const attached = (docs ?? []).filter((d) => d.assignment_id === assignment.id);

        return (
          <article key={assignment.id} className="rounded-2xl border border-border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <ClipboardList className="size-4 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="font-medium">{assignment.title}</p>
                <p className="text-xs text-muted-foreground">
                  {assignment.classes?.name ?? "Class"} · {formatDue(assignment.due_at)}
                </p>
              </div>
              <div className="flex gap-1">
                {(
                  [
                    ["not_started", "Not started"],
                    ["in_progress", "In progress"],
                    ["done", "Done"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={status === value ? "default" : "ghost"}
                    onClick={() => setStatus.mutate({ assignmentId: assignment.id, status: value })}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>

            {assignment.instructions && (
              <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                {assignment.instructions}
              </p>
            )}

            {attached.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {attached.map((doc) => (
                  <li key={doc.document_id}>
                    <button
                      onClick={() => {
                        void openStoredDocument(doc.document_id).catch((error: unknown) =>
                          toast.error(error instanceof Error ? error.message : "Could not open."),
                        );
                      }}
                      className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs"
                    >
                      <FileText className="size-3 text-primary" />
                      {doc.documents?.file_name ?? "Document"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </div>
  );
}
