import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { useRoles } from "@/hooks/use-role";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Users, Plus, Copy, FileText, Activity, GraduationCap, Loader2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/classes")({
  head: () => ({
    meta: [
      { title: "Classes — Solution.AI" },
      {
        name: "description",
        content:
          "Create classes, share knowledge bases with students and track their study activity in Solution.AI.",
      },
      { property: "og:title", content: "Classes — Solution.AI" },
      { property: "og:description", content: "Teacher workspace for shared knowledge bases." },
    ],
  }),
  component: ClassesPage,
});

type ClassRow = {
  id: string;
  name: string;
  subject: string | null;
  join_code: string;
  teacher_id: string;
};

function ClassesPage() {
  const { isTeacher, loading } = useRoles();

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
        <Skeleton className="h-32 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">Classes</h1>
        <p className="mt-2 text-muted-foreground">
          {isTeacher
            ? "Create a class, share your indexed documents and see how your students are studying."
            : "Join a class with the code your teacher gave you to unlock their shared materials."}
        </p>
      </header>

      {isTeacher ? <TeacherView /> : <StudentView />}
    </div>
  );
}

function TeacherView() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const { data: classes, isLoading } = useQuery({
    queryKey: ["classes", "teaching"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, subject, join_code, teacher_id")
        .eq("teacher_id", user?.id ?? "")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ClassRow[];
    },
    enabled: Boolean(user?.id),
  });

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("classes").insert({
        teacher_id: user!.id,
        name: name.trim(),
        subject: subject.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setName("");
      setSubject("");
      toast.success("Class created.");
      queryClient.invalidateQueries({ queryKey: ["classes", "teaching"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not create."),
  });

  return (
    <>
      <section className="glass mt-8 rounded-3xl p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Plus className="size-4 text-primary" /> New class
        </h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Class name" />
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional)"
          />
          <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </div>
      </section>

      <section className="mt-8 space-y-3">
        {isLoading && <Skeleton className="h-24 w-full rounded-2xl" />}
        {!isLoading && (classes?.length ?? 0) === 0 && (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            No classes yet. Create one above and share the join code with your students.
          </div>
        )}
        {classes?.map((klass) => (
          <article key={klass.id} className="glass rounded-2xl p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-accent">
                <GraduationCap className="size-5 text-primary" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{klass.name}</p>
                {klass.subject && (
                  <p className="text-xs text-muted-foreground">{klass.subject}</p>
                )}
              </div>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(klass.join_code);
                  toast.success("Join code copied.");
                }}
                className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-xs"
              >
                {klass.join_code}
                <Copy className="size-3" />
              </button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSelected(selected === klass.id ? null : klass.id)}
              >
                {selected === klass.id ? "Hide" : "Manage"}
              </Button>
            </div>

            {selected === klass.id && (
              <Tabs defaultValue="documents" className="mt-5">
                <TabsList>
                  <TabsTrigger value="documents">Shared documents</TabsTrigger>
                  <TabsTrigger value="activity">Student activity</TabsTrigger>
                </TabsList>
                <TabsContent value="documents" className="mt-4">
                  <SharedDocuments classId={klass.id} />
                </TabsContent>
                <TabsContent value="activity" className="mt-4">
                  <ClassActivity classId={klass.id} />
                </TabsContent>
              </Tabs>
            )}
          </article>
        ))}
      </section>
    </>
  );
}

function SharedDocuments({ classId }: { classId: string }) {
  const queryClient = useQueryClient();

  const { data: docs } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; file_name: string; status: string }[];
    },
  });

  const { data: shared } = useQuery({
    queryKey: ["class-documents", classId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_documents")
        .select("document_id")
        .eq("class_id", classId);
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.document_id));
    },
  });

  const toggle = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from("class_documents")
          .insert({ class_id: classId, document_id: id });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("class_documents")
          .delete()
          .eq("class_id", classId)
          .eq("document_id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["class-documents", classId] }),
    onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed."),
  });

  if (!docs?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Upload documents in My Documents first, then share them here.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {docs.map((doc) => {
        const on = shared?.has(doc.id) ?? false;
        return (
          <li key={doc.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
            <FileText className="size-4 text-primary" />
            <span className="min-w-0 flex-1 truncate text-sm">{doc.file_name}</span>
            {on && <Badge variant="secondary">Shared</Badge>}
            <Button
              size="sm"
              variant={on ? "ghost" : "secondary"}
              onClick={() => toggle.mutate({ id: doc.id, on: !on })}
            >
              {on ? "Unshare" : "Share"}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

function ClassActivity({ classId }: { classId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["class-activity", classId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("class_activity", { _class_id: classId });
      if (error) throw error;
      return data as {
        student_id: string;
        display_name: string | null;
        documents_count: number;
        questions_count: number;
        last_active: string | null;
      }[];
    },
  });

  if (isLoading) return <Skeleton className="h-20 w-full rounded-xl" />;
  if (!data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No students have joined yet. Share the join code to get started.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground uppercase">
          <tr>
            <th className="py-2 text-left">Student</th>
            <th className="py-2 text-right">Documents</th>
            <th className="py-2 text-right">Questions</th>
            <th className="py-2 text-right">Last active</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.student_id} className="border-t border-border">
              <td className="py-2">{row.display_name ?? "Student"}</td>
              <td className="py-2 text-right">{row.documents_count}</td>
              <td className="py-2 text-right">{row.questions_count}</td>
              <td className="py-2 text-right text-muted-foreground">
                {row.last_active ? new Date(row.last_active).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StudentView() {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const [code, setCode] = useState("");

  const { data: classes, isLoading } = useQuery({
    queryKey: ["classes", "joined"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("class_members")
        .select("class_id, classes(id, name, subject, join_code, teacher_id)")
        .eq("student_id", user?.id ?? "");
      if (error) throw error;
      return (data ?? [])
        .map((row) => row.classes as unknown as ClassRow | null)
        .filter((row): row is ClassRow => Boolean(row));
    },
    enabled: Boolean(user?.id),
  });

  const join = useMutation({
    mutationFn: async () => {
      const { data: found, error: findError } = await supabase
        .from("classes")
        .select("id")
        .eq("join_code", code.trim().toUpperCase())
        .maybeSingle();
      if (findError) throw findError;
      if (!found) throw new Error("No class found with that code.");
      const { error } = await supabase
        .from("class_members")
        .insert({ class_id: found.id, student_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      setCode("");
      toast.success("Joined the class — shared materials are now searchable in chat.");
      queryClient.invalidateQueries({ queryKey: ["classes", "joined"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Could not join."),
  });

  return (
    <>
      <section className="glass mt-8 rounded-3xl p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Users className="size-4 text-primary" /> Join a class
        </h2>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Join code, e.g. 7QK2AF"
            className="font-mono"
          />
          <Button disabled={!code.trim() || join.isPending} onClick={() => join.mutate()}>
            {join.isPending && <Loader2 className="size-4 animate-spin" />}
            Join
          </Button>
        </div>
      </section>

      <section className="mt-8 space-y-3">
        {isLoading && <Skeleton className="h-20 w-full rounded-2xl" />}
        {!isLoading && (classes?.length ?? 0) === 0 && (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            You haven't joined any classes yet.
          </div>
        )}
        {classes?.map((klass) => (
          <article key={klass.id} className="glass flex items-center gap-3 rounded-2xl p-5">
            <span className="flex size-10 items-center justify-center rounded-xl bg-accent">
              <Activity className="size-5 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{klass.name}</p>
              {klass.subject && <p className="text-xs text-muted-foreground">{klass.subject}</p>}
            </div>
            <Badge variant="secondary">Joined</Badge>
          </article>
        ))}
      </section>
    </>
  );
}
