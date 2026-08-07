import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { askQuestion } from "@/lib/rag.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Send, Sparkle, Quote, Plus } from "lucide-react";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "AI Chat — Solution.AI" },
      {
        name: "description",
        content:
          "Ask questions and get answers grounded in your own uploaded documents, with page-level citations.",
      },
      { property: "og:title", content: "AI Chat — Solution.AI" },
      { property: "og:description", content: "Cited answers from your study materials." },
    ],
  }),
  component: ChatPage,
});

type Citation = {
  marker: number;
  fileName: string;
  page: number;
  snippet: string;
  confidence: number;
};

type Message = {
  id: string;
  role: string;
  content: string;
  citations: Citation[] | null;
};

const SUGGESTIONS = [
  "Summarise the key ideas from my notes",
  "Explain this topic step by step with examples",
  "Give me 5 practice questions with answers",
];

function ChatPage() {
  const queryClient = useQueryClient();
  const ask = useServerFn(askQuestion);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
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
        .order("updated_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return data as { id: string; title: string }[];
    },
  });

  const send = useMutation({
    mutationFn: async (question: string) => ask({ data: { question, conversationId } }),
    onSuccess: (result) => {
      setConversationId(result.conversationId);
      queryClient.invalidateQueries({ queryKey: ["messages", result.conversationId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not answer that right now."),
    onSettled: () => setPendingQuestion(null),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingQuestion]);

  function submit(question: string) {
    const value = question.trim();
    if (!value || send.isPending) return;
    setInput("");
    setPendingQuestion(value);
    send.mutate(value);
  }

  const shown = messages ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col md:h-screen">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-8">
        <div>
          <h1 className="text-lg font-semibold">AI Chat</h1>
          <p className="text-xs text-muted-foreground">
            Answers come only from your uploaded documents
          </p>
        </div>
        <div className="flex items-center gap-2">
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
                    onClick={() => submit(s)}
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
                {message.citations && message.citations.length > 0 && (
                  <div className="space-y-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      <Quote className="size-3" /> Sources
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {message.citations.map((citation) => (
                        <div key={citation.marker} className="glass rounded-xl p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-xs font-medium">
                              [{citation.marker}] {citation.fileName}
                            </p>
                            <Badge variant="secondary">{citation.confidence}%</Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Page {citation.page}
                          </p>
                          <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
                            {citation.snippet}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Searching your documents and reasoning...
              </p>
            </>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
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
                submit(input);
              }
            }}
            placeholder="Ask a question about your uploaded material..."
            className="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          <Button type="submit" size="icon" disabled={send.isPending || !input.trim()}>
            {send.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}