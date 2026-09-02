import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ingestDocument } from "@/lib/rag.functions";
import { deleteDocument } from "@/lib/documents.functions";
import { ocrPages } from "@/lib/ocr.functions";
import { extractPages } from "@/lib/extract-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UploadCloud,
  FileText,
  Trash2,
  Loader2,
  Layers,
  RefreshCw,
  ExternalLink,
  X,
  Check,
  AlertTriangle,
} from "lucide-react";

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
  storage_path: string | null;
};

function LibraryPage() {
  const queryClient = useQueryClient();
  const ingest = useServerFn(ingestDocument);
  const removeDocument = useServerFn(deleteDocument);
  const runOcr = useServerFn(ocrPages);
  const inputRef = useRef<HTMLInputElement>(null);
  const [subject, setSubject] = useState("");
  const [newSubject, setNewSubject] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const cancelled = useRef<Set<string>>(new Set());
  const running = useRef(false);

  const { data: subjects } = useQuery({
    queryKey: ["subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subjects")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });

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

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setQueue((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const processFile = useCallback(
    async (id: string, file: File, subjectName: string | null) => {
      patchItem(id, { status: "working", stage: "Reading file...", progress: 10 });
      const pages = await extractPages(file, async (images) => {
        patchItem(id, { stage: `Running OCR on ${images.length} scanned page(s)...`, progress: 35 });
        const { texts } = await runOcr({ data: { images } });
        return texts;
      });

      patchItem(id, { stage: "Uploading original...", progress: 60 });
      const path = `${crypto.randomUUID()}-${file.name}`;
      const { error: storageError } = await supabase.storage
        .from("documents")
        .upload(path, file, { contentType: file.type || "application/octet-stream" });
      if (storageError) throw new Error(storageError.message);

      patchItem(id, { stage: "Chunking + embedding...", progress: 80 });
      const result = await ingest({
        data: {
          fileName: file.name,
          fileType: file.type || "application/octet-stream",
          fileSize: file.size,
          storagePath: path,
          subject: subjectName,
          pages,
        },
      });

      if (subjectName) {
        await supabase.from("subjects").insert({ name: subjectName }).select().maybeSingle();
        queryClient.invalidateQueries({ queryKey: ["subjects"] });
      }

      patchItem(id, {
        status: "done",
        stage: `Indexed ${result.chunks} passages`,
        progress: 100,
      });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["my-usage"] });
    },
    [ingest, patchItem, queryClient, runOcr],
  );

  const remove = useMutation({
    mutationFn: async (id: string) => removeDocument({ data: { documentId: id } }),
    onSuccess: () => {
      toast.success("Document and stored file removed.");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Delete failed."),
  });

  const retry = useMutation({
    mutationFn: async (doc: Doc) => {
      if (!doc.storage_path) throw new Error("Original file is no longer stored — re-upload it.");
      setStage(`Re-reading ${doc.file_name}...`);
      const { data: blob, error } = await supabase.storage
        .from("documents")
        .download(doc.storage_path);
      if (error || !blob) throw new Error(error?.message ?? "Could not read the stored file.");

      const file = new File([blob], doc.file_name, { type: doc.file_type });
      const pages = await extractPages(file, async (images) => {
        setStage("Scanned pages detected — running OCR...");
        const { texts } = await runOcr({ data: { images } });
        return texts;
      });

      setStage("Re-indexing passages...");
      const result = await ingest({
        data: {
          fileName: doc.file_name,
          fileType: doc.file_type,
          fileSize: doc.file_size,
          storagePath: doc.storage_path,
          subject: doc.subject,
          pages,
        },
      });
      await supabase.from("documents").delete().eq("id", doc.id);
      return result;
    },
    onSuccess: (result) => {
      toast.success(`Re-indexed ${result.chunks} passages.`);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Retry failed."),
    onSettled: () => setStage(null),
  });

  async function openOriginal(doc: Doc) {
    if (!doc.storage_path) {
      toast.error("No stored original for this document.");
      return;
    }
    const { data, error } = await supabase.storage
      .from("documents")
      .createSignedUrl(doc.storage_path, 60);
    if (error || !data) {
      toast.error(error?.message ?? "Could not open the file.");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) return;
      const subjectName = subject.trim() || null;
      const added = Array.from(files).map((file) => ({
        item: {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          status: "queued" as const,
          stage: "Waiting...",
          progress: 0,
        },
        file,
        subjectName,
      }));
      setQueue((items) => [...items, ...added.map((a) => a.item)]);
      pending.current.push(...added);

      if (running.current) return;
      running.current = true;
      try {
        while (pending.current.length) {
          const next = pending.current.shift()!;
          if (cancelled.current.has(next.item.id)) continue;
          try {
            await processFile(next.item.id, next.file, next.subjectName);
          } catch (error) {
            patchItem(next.item.id, {
              status: "failed",
              stage: error instanceof Error ? error.message : "Upload failed.",
              progress: 100,
            });
            toast.error(`${next.file.name}: ${error instanceof Error ? error.message : "failed"}`);
          }
        }
      } finally {
        running.current = false;
      }
    },
    [patchItem, processFile, subject],
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
          PDF, DOCX, images, TXT, MD — scanned pages go through OCR automatically
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
            accept=".pdf,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
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
            {doc.storage_path && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void openOriginal(doc)}
                aria-label={`Open ${doc.file_name}`}
              >
                <ExternalLink className="size-4" />
              </Button>
            )}
            {doc.status === "failed" && (
              <Button
                variant="ghost"
                size="icon"
                disabled={retry.isPending}
                onClick={() => retry.mutate(doc)}
                aria-label={`Retry ${doc.file_name}`}
              >
                {retry.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              disabled={remove.isPending}
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