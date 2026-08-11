import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { streamText } from "ai";
import { authenticateRequest } from "@/lib/request-auth.server";
import { buildContextBlock, RAG_SYSTEM_PROMPT } from "@/lib/rag.server";
import type { RetrievedChunk } from "@/lib/rag.server";
import { createResponsesProvider, embedTexts, getLovableApiKey } from "@/lib/ai-gateway.server";

const Body = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.string().uuid().nullable().optional(),
  documentIds: z.array(z.string().uuid()).max(100).nullable().optional(),
});

const NO_MATCH =
  "I couldn't find anything about this in your selected materials. Try uploading the relevant notes, book chapter or PDF first — I only answer from your own knowledge sources.";

export const Route = createFileRoute("/api/chat/stream")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let auth: Awaited<ReturnType<typeof authenticateRequest>>;
        try {
          auth = await authenticateRequest(request);
        } catch {
          return new Response("Unauthorized", { status: 401 });
        }

        const parsed = Body.safeParse(await request.json());
        if (!parsed.success) return new Response("Invalid request", { status: 400 });
        const { question } = parsed.data;
        const documentIds = parsed.data.documentIds?.length ? parsed.data.documentIds : null;
        const { supabase, userId } = auth;
        const apiKey = getLovableApiKey();

        let conversationId = parsed.data.conversationId ?? null;
        if (!conversationId) {
          const { data: conv, error } = await supabase
            .from("conversations")
            .insert({ user_id: userId, title: question.slice(0, 60) })
            .select("id")
            .single();
          if (error || !conv) return new Response("Could not start conversation", { status: 500 });
          conversationId = conv.id;
        }

        await supabase
          .from("messages")
          .insert({ conversation_id: conversationId, user_id: userId, role: "user", content: question });

        const [queryVector] = await embedTexts(apiKey, [question]);
        const { data: matches, error: matchError } = await supabase.rpc(
          "hybrid_match_document_chunks",
          {
            query_embedding: JSON.stringify(queryVector),
            query_text: question,
            match_count: 10,
            filter_document_ids: documentIds ?? undefined,
          },
        );
        if (matchError) return new Response(matchError.message, { status: 500 });

        const retrieved = ((matches ?? []) as (RetrievedChunk & { score: number })[]).filter(
          (c) => c.similarity > 0.2 || c.score > 0.2,
        );

        const citations = retrieved.map((c, i) => ({
          marker: i + 1,
          documentId: c.document_id,
          fileName: c.file_name,
          page: c.page_number,
          subject: c.subject,
          snippet: c.content.slice(0, 220),
          confidence: Math.round(Math.max(c.similarity, 0) * 100),
        }));

        const encoder = new TextEncoder();
        const line = (payload: unknown) => encoder.encode(`${JSON.stringify(payload)}\n`);

        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue(line({ type: "meta", conversationId, citations }));
            let answer = "";
            try {
              if (retrieved.length === 0) {
                answer = NO_MATCH;
                controller.enqueue(line({ type: "delta", text: answer }));
              } else {
                const provider = createResponsesProvider(apiKey);
                const result = streamText({
                  model: provider.responses("openai/gpt-5.6-sol"),
                  system: RAG_SYSTEM_PROMPT,
                  prompt: `Retrieved excerpts from the student's materials:\n\n${buildContextBlock(
                    retrieved,
                  )}\n\nQuestion: ${question}`,
                  providerOptions: { openai: { store: false } },
                });
                for await (const delta of result.textStream) {
                  answer += delta;
                  controller.enqueue(line({ type: "delta", text: delta }));
                }
                answer = answer.trim();
                if (!answer) {
                  answer = "I couldn't generate an answer for that. Please rephrase your question.";
                  controller.enqueue(line({ type: "delta", text: answer }));
                }
              }

              await supabase.from("messages").insert({
                conversation_id: conversationId,
                user_id: userId,
                role: "assistant",
                content: answer,
                citations: retrieved.length === 0 ? [] : citations,
              });
              await supabase
                .from("conversations")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", conversationId);

              controller.enqueue(line({ type: "done" }));
            } catch (error) {
              controller.enqueue(
                line({
                  type: "error",
                  message: error instanceof Error ? error.message : "Answer failed.",
                }),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});