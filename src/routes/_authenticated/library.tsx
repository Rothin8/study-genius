import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ingestDocument } from "@/lib/rag.functions";
import { extractPages } from "@/lib/extract-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { UploadCloud, FileText, Trash2, Loader2, Layers } from "lucide-react";

export const Route = createFileRoute("/_authenticated/library")({
  head: () => ({
    meta: [
      { title: "My Documents — Solution.AI" },
      {
        name: "description",
        content:
          "Upload PDFs, DOCX and notes. Solution.AI extracts, chunks and indexes them for cited AI answers.",
      },
      { property: "og:title", content: "My Documents — Solution.AI" },
      { property: "og:description", content: "Your indexed study knowledge base." },
    ],
  }),
  component: LibraryPage,
});

type Doc = {
  id: string;
  file_name: string;
  file_type: string;
  file_size: number;
  subject: string | null;
  status: string;
  error_message: string | null;
  page_count: number;
  chunk_count: number;
  created_at: string;
};

function LibraryPage() {
  const queryClient = useQueryClient();
  const ingest = useServerFn(ingestDocument);
  const inputRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const { data: docs, isLoading } = useQuery({
    queryKey: ["documents"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Doc[];
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setStage(`Reading ${file.name}...`);
      const pages = await extractPages(file);

      setStage("Uploading original file...");
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: storageError } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (storageError) throw new Error(storageError.message);

      setStage("Chunking + generating embeddings...");
      return ingest({
        data: {
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          storagePath: path,
          subject: subject.trim() || null,
          pages,
        },
      });
    },
    onSuccess: (result) => {
      toast.success(`Indexed ${result.chunks} passages — ready to ask questions.`);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Upload failed."),
    onSettled: () => setStage(null),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Document removed.");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed."),
  });

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      for (const file of Array.from(files)) {
        await upload.mutateAsync(file).catch(() => undefined);
      }
    },
    [upload],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">My Documents</h1>
        <p className="mt-2 text-muted-foreground">
          Upload PDFs, DOCX, TXT or Markdown. Every file is cleaned, chunked, embedded and indexed
          so answers stay grounded in your own material.
        </p>
      </header>

      <section
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void handleFiles(e.dataTransfer.files);
        }}
        className={`glass mt-8 rounded-3xl p-8 text-center transition-colors ${
          dragging ? "shadow-glow" : ""
        }`}
      >
        <UploadCloud className="mx-auto size-8 text-primary" />
        <h2 className="mt-4 text-lg font-semibold">Drag & drop your study material</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          PDF, DOCX, TXT, MD — up to 20MB per file
        </p>

        <div className="mx-auto mt-6 flex max-w-sm flex-col gap-3">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject or course (optional)"
          />
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.md,.csv"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
            {upload.isPending && <Loader2 className="size-4 animate-spin" />}
            {upload.isPending ? "Processing..." : "Choose files"}
          </Button>
          {stage && <p className="text-xs text-muted-foreground">{stage}</p>}
        </div>
      </section>

      <section className="mt-10 space-y-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Knowledge base
        </h2>

        {isLoading && <Skeleton className="h-20 w-full rounded-2xl" />}

        {!isLoading && (docs?.length ?? 0) === 0 && (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            Nothing here yet. Upload your first PDF or notes to start asking questions.
          </div>
        )}

        {docs?.map((doc) => (
          <article key={doc.id} className="glass flex items-center gap-4 rounded-2xl p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent">
              <FileText className="size-5 text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{doc.file_name}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {doc.subject && <span>{doc.subject}</span>}
                <span>{doc.page_count} pages</span>
                <span className="flex items-center gap-1">
                  <Layers className="size-3" />
                  {doc.chunk_count} chunks
                </span>
                <span>{(doc.file_size / 1024).toFixed(0)} KB</span>
              </p>
              {doc.status === "failed" && doc.error_message && (
                <p className="mt-1 text-xs text-destructive">{doc.error_message}</p>
              )}
            </div>
            <Badge variant={doc.status === "ready" ? "default" : "secondary"}>{doc.status}</Badge>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => remove.mutate(doc.id)}
              aria-label={`Delete ${doc.file_name}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
}