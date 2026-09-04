import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { openStoredDocument } from "@/lib/open-document";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Send,
  Sparkle,
  Quote,
  Plus,
  Trash2,
  Pencil,
  Library,
  Check,
  ExternalLink,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "AI Chat — Solution.AI" },
      {
        name: "description",
        content:
          "Ask questions and get streamed answers grounded in your own uploaded documents, with page-level citations.",
      },
      { property: "og:title", content: "AI Chat — Solution.AI" },
      { property: "og:description", content: "Cited answers from your study materials." },
    ],
  }),
  component: ChatPage,
});

type Citation = {
  marker: number;
  documentId?: string | null;
  fileName: string;
  page: number | null;
  snippet: string;
  confidence: number;
};

type Message = {
  id: string;
  role: string;
  content: string;
  citations: Citation[] | null;
};

type Conversation = { id: string; title: string; updated_at: string };

const SUGGESTIONS = [
  "Summarise the key ideas from my notes",
  "Explain this topic step by step with examples",
  "Give me 5 practice questions with answers",
];

function ChatPage() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [streamed, setStreamed] = useState("");
  const [streamCitations, setStreamCitations] = useState<Citation[]>([]);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<string[]>([]);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages } = useQuery({
    queryKey: ["messages", conversationId],
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, citations")
        .eq("conversation_id", conversationId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as unknown as Message[];
    },
  });

  const { data: conversations } = useQuery({
    queryKey: ["conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, title, updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Conversation[];
    },
  });

  const { data: docs } = useQuery({
    queryKey: ["documents", "ready"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("id, file_name, subject, status")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as { id: string; file_name: string; subject: string | null; status: string }[];
    },
  });

  const readyDocs = useMemo(() => (docs ?? []).filter((d) => d.status === "ready"), [docs]);
  const pendingDocs = useMemo(() => (docs ?? []).filter((d) => d.status !== "ready"), [docs]);


  const scopeLabel = useMemo(() => {
    if (scope.length === 0) return "All my materials";
    if (scope.length === 1) {
      return docs?.find((d) => d.id === scope[0])?.file_name ?? "1 document";
    }
    return `${scope.length} documents`;
  }, [scope, docs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestion, streamed]);

  async function submit(question: string) {
    const value = question.trim();
    if (!value || busy) return;
    setInput("");
    setPendingQuestion(value);
    setStreamed("");
    setStreamCitations([]);
    setBusy(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your session expired. Please sign in again.");

      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          question: value,
          conversationId,
          documentIds: scope.length > 0 ? scope : null,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(await response.text().catch(() => "Could not answer that right now."));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let newConversationId = conversationId;

      for (;;) {
        const { value: bytes, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const event = JSON.parse(raw) as {
            type: string;
            text?: string;
            message?: string;
            conversationId?: string;
            citations?: Citation[];
          };
          if (event.type === "meta") {
            newConversationId = event.conversationId ?? newConversationId;
            setStreamCitations(event.citations ?? []);
          } else if (event.type === "delta") {
            setStreamed((prev) => prev + (event.text ?? ""));
          } else if (event.type === "error") {
            throw new Error(event.message ?? "Answer failed.");
          }
        }
      }

      if (newConversationId) {
        setConversationId(newConversationId);
        await queryClient.invalidateQueries({ queryKey: ["messages", newConversationId] });
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not answer that right now.");
    } finally {
      setBusy(false);
      setPendingQuestion(null);
      setStreamed("");
      setStreamCitations([]);
    }
  }

  async function renameConversation(id: string) {
    const title = renameValue.trim();
    setRenamingId(null);
    if (!title) return;
    const { error } = await supabase.from("conversations").update({ title }).eq("id", id);
    if (error) toast.error(error.message);
    else await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  async function deleteConversation(id: string) {
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (conversationId === id) setConversationId(null);
    toast.success("Chat deleted.");
    await queryClient.invalidateQueries({ queryKey: ["conversations"] });
  }

  const shown = messages ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col md:h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
        <div>
          <h1 className="text-lg font-semibold">AI Chat</h1>
          <p className="text-xs text-muted-foreground">
            Answers come only from your uploaded documents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setScopeOpen((open) => !open)}>
            <Library className="size-4" />
            <span className="max-w-32 truncate">{scopeLabel}</span>
          </Button>
          {(conversations?.length ?? 0) > 0 && (
            <select
              value={conversationId ?? ""}
              onChange={(e) => setConversationId(e.target.value || null)}
              className="max-w-40 rounded-lg border border-input bg-transparent px-2 py-1.5 text-xs text-muted-foreground"
              aria-label="Previous conversations"
            >
              <option value="">Recent chats</option>
              {conversations?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" size="sm" onClick={() => setConversationId(null)}>
            <Plus className="size-4" />
            New
          </Button>
        </div>
      </header>

      {scopeOpen && (
        <div className="border-b border-border px-4 py-3 md:px-8">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Search in
              </p>
              <Button variant="ghost" size="sm" onClick={() => setScope([])}>
                All materials
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(docs?.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground">
                  No indexed documents yet — upload one from My Documents.
                </p>
              )}
              {docs?.map((doc) => {
                const active = scope.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() =>
                      setScope((prev) =>
                        prev.includes(doc.id)
                          ? prev.filter((id) => id !== doc.id)
                          : [...prev, doc.id],
                      )
                    }
                    className={`flex max-w-64 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      active
                        ? "border-primary bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/50"
                    }`}
                  >
                    {active && <Check className="size-3 shrink-0" />}
                    <span className="truncate">{doc.file_name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {shown.length === 0 && !pendingQuestion && (
            <div className="glass rounded-3xl p-8 text-center">
              <span className="bg-gradient-accent mx-auto flex size-11 items-center justify-center rounded-2xl">
                <Sparkle className="size-5 text-primary-foreground" />
              </span>
              <h2 className="mt-4 text-xl font-semibold">Ask anything from your library</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Every answer is grounded in your own documents and cited by page.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void submit(s)}
                    className="rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {shown.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={message.id} className="space-y-3">
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
                <Citations citations={message.citations ?? []} />
              </div>
            ),
          )}

          {pendingQuestion && (
            <>
              <div className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {pendingQuestion}
                </p>
              </div>
              {streamed ? (
                <div className="space-y-3">
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamed}</ReactMarkdown>
                  </div>
                  <Citations citations={streamCitations} />
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Searching your documents and reasoning...
                </p>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {(conversations?.length ?? 0) > 0 && (
        <div className="border-t border-border px-4 py-3 md:px-8">
          <div className="mx-auto flex max-w-3xl flex-wrap gap-2">
            {conversations?.slice(0, 8).map((c) =>
              renamingId === c.id ? (
                <span key={c.id} className="flex items-center gap-1">
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void renameConversation(c.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="h-8 w-40 text-xs"
                    autoFocus
                  />
                  <Button size="sm" variant="ghost" onClick={() => void renameConversation(c.id)}>
                    Save
                  </Button>
                </span>
              ) : (
                <span
                  key={c.id}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${
                    conversationId === c.id
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  <button className="max-w-40 truncate" onClick={() => setConversationId(c.id)}>
                    {c.title}
                  </button>
                  <button
                    aria-label={`Rename ${c.title}`}
                    onClick={() => {
                      setRenamingId(c.id);
                      setRenameValue(c.title);
                    }}
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    aria-label={`Delete ${c.title}`}
                    onClick={() => void deleteConversation(c.id)}
                  >
                    <Trash2 className="size-3" />
                  </button>
                </span>
              ),
            )}
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
        className="border-t border-border px-4 py-4 md:px-8"
      >
        <div className="glass mx-auto flex max-w-3xl items-end gap-2 rounded-2xl p-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(input);
              }
            }}
            placeholder="Ask a question about your uploaded material..."
            className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function Citations({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Quote className="size-3" /> Sources
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {citations.map((citation) => (
          <div key={citation.marker} className="glass rounded-xl p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-xs font-medium">
                [{citation.marker}] {citation.fileName}
              </p>
              <Badge variant="secondary">{citation.confidence}%</Badge>
            </div>
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{citation.snippet}</p>
            {citation.documentId && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 -ml-2 h-7 text-xs text-primary"
                onClick={() =>
                  openStoredDocument(citation.documentId!, citation.page).catch((error) =>
                    toast.error(error instanceof Error ? error.message : "Could not open source."),
                  )
                }
              >
                <ExternalLink className="size-3" />
                {citation.page != null ? `Open page ${citation.page}` : "Open source"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
