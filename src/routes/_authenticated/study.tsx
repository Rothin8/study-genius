import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateStudySet } from "@/lib/study.functions";
import { openStoredDocument } from "@/lib/open-document";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, GraduationCap, Eye, RotateCcw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/study")({
  head: () => ({
    meta: [
      { title: "Study Tools — Solution.AI" },
      {
        name: "description",
        content:
          "Generate quizzes, flashcards and revision summaries from your own indexed documents, cited back to pages.",
      },
      { property: "og:title", content: "Study Tools — Solution.AI" },
      { property: "og:description", content: "Quizzes, flashcards and summaries from your notes." },
    ],
  }),
  component: StudyPage,
});

type Mode = "quiz" | "flashcards" | "summary";
const MODES: { id: Mode; label: string }[] = [
  { id: "quiz", label: "Quiz" },
  { id: "flashcards", label: "Flashcards" },
  { id: "summary", label: "Summary" },
];

function StudyPage() {
  const generate = useServerFn(generateStudySet);
  const [documentId, setDocumentId] = useState("");
  const [mode, setMode] = useState<Mode>("quiz");
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});

  const { data: docs } = useQuery({
    queryKey: ["documents", "ready"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, subject")
        .eq("status", "ready")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; file_name: string; subject: string | null }[];
    },
  });

  const run = useMutation({
    mutationFn: async () => {
      if (!documentId) throw new Error("Pick a document first.");
      setRevealed({});
      return generate({ data: { documentId, mode, count: mode === "summary" ? 8 : 8 } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not generate that."),
  });

  const result = run.data;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">Study Tools</h1>
        <p className="mt-2 text-muted-foreground">
          Turn any indexed document into a quiz, a flashcard deck or a revision summary — every item
          points back to the page it came from.
        </p>
      </header>

      <section className="glass mt-8 space-y-4 rounded-3xl p-6">
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={mode === m.id ? "default" : "secondary"}
              onClick={() => setMode(m.id)}
            >
              {m.label}
            </Button>
          ))}
        </div>
        <select
          value={documentId}
          onChange={(e) => setDocumentId(e.target.value)}
          aria-label="Document"
          className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm"
        >
          <option value="">Choose a document…</option>
          {docs?.map((d) => (
            <option key={d.id} value={d.id}>
              {d.file_name}
              {d.subject ? ` — ${d.subject}` : ""}
            </option>
          ))}
        </select>
        {(docs?.length ?? 0) === 0 && (
          <p className="text-xs text-muted-foreground">
            No indexed documents yet — upload one from My Documents.
          </p>
        )}
        <Button onClick={() => run.mutate()} disabled={run.isPending || !documentId}>
          {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <GraduationCap className="size-4" />}
          {run.isPending ? "Generating…" : "Generate"}
        </Button>
      </section>

      {result && (
        <section className="mt-8 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{result.set.title}</h2>
            <Button size="sm" variant="ghost" onClick={() => run.mutate()} disabled={run.isPending}>
              <RotateCcw className="size-4" /> Regenerate
            </Button>
          </div>

          {result.mode === "quiz" &&
            result.set.quiz.map((q, i) => (
              <article key={i} className="glass space-y-2 rounded-2xl p-4">
                <p className="text-sm font-medium">
                  {i + 1}. {q.question}
                </p>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {q.options.map((option, oi) => (
                    <li
                      key={oi}
                      className={
                        revealed[i] && oi === q.answerIndex ? "font-medium text-primary" : undefined
                      }
                    >
                      {String.fromCharCode(65 + oi)}. {option}
                    </li>
                  ))}
                </ul>
                {revealed[i] ? (
                  <p className="text-xs text-muted-foreground">{q.explanation}</p>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRevealed((prev) => ({ ...prev, [i]: true }))}
                  >
                    <Eye className="size-3" /> Show answer
                  </Button>
                )}
                <PageLink documentId={documentId} page={q.page} />
              </article>
            ))}

          {result.mode === "flashcards" &&
            result.set.flashcards.map((card, i) => (
              <article key={i} className="glass space-y-2 rounded-2xl p-4">
                <p className="text-sm font-medium">{card.front}</p>
                {revealed[i] ? (
                  <p className="text-sm text-muted-foreground">{card.back}</p>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRevealed((prev) => ({ ...prev, [i]: true }))}
                  >
                    <Eye className="size-3" /> Flip
                  </Button>
                )}
                <PageLink documentId={documentId} page={card.page} />
              </article>
            ))}

          {result.mode === "summary" &&
            result.set.summary.map((section, i) => (
              <article key={i} className="glass space-y-1 rounded-2xl p-4">
                <p className="text-sm font-medium">{section.heading}</p>
                <p className="text-sm text-muted-foreground">{section.body}</p>
                <PageLink documentId={documentId} page={section.page} />
              </article>
            ))}
        </section>
      )}
    </div>
  );
}

function PageLink({ documentId, page }: { documentId: string; page: number | null }) {
  if (page == null) return null;
  return (
    <button
      className="text-xs text-primary underline-offset-2 hover:underline"
      onClick={() =>
        openStoredDocument(documentId, page).catch((error: unknown) =>
          toast.error(error instanceof Error ? error.message : "Could not open the file."),
        )
      }
    >
      <Badge variant="secondary">Page {page}</Badge>
    </button>
  );
}
