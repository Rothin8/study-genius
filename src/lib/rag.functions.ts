import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { chunkPages, buildContextBlock, RAG_SYSTEM_PROMPT } from "./rag.server";
import type { RetrievedChunk } from "./rag.server";
import { embedTexts, getLovableApiKey, createResponsesProvider } from "./ai-gateway.server";
import { streamText } from "ai";

const IngestInput = z.object({
  fileName: z.string().min(1),
  fileType: z.string().min(1),
  fileSize: z.number().int().nonnegative(),
  storagePath: z.string().nullable(),
  subject: z.string().nullable(),
  pages: z.array(z.object({ page: z.number().int().positive(), text: z.string() })).min(1),
});

export const ingestDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IngestInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        user_id: userId,
        file_name: data.fileName,
        file_type: data.fileType,
        file_size: data.fileSize,
        storage_path: data.storagePath,
        subject: data.subject,
        status: "processing",
        page_count: data.pages.length,
      })
      .select("id")
      .single();
    if (docError || !doc) throw new Error(docError?.message ?? "Could not save document.");

    try {
      const chunks = chunkPages(data.pages);
      if (chunks.length === 0) throw new Error("No readable text found in this file.");

      const vectors = await embedTexts(getLovableApiKey(), chunks.map((c) => c.content));

      const rows = chunks.map((c, i) => ({
        document_id: doc.id,
        user_id: userId,
        content: c.content,
        page_number: c.page,
        chunk_index: c.index,
        embedding: JSON.stringify(vectors[i]),
      }));

      for (let i = 0; i < rows.length; i += 50) {
        const { error } = await supabase.from("document_chunks").insert(rows.slice(i, i + 50));
        if (error) throw new Error(error.message);
      }

      await supabase
        .from("documents")
        .update({ status: "ready", chunk_count: chunks.length })
        .eq("id", doc.id);

      return { documentId: doc.id, chunks: chunks.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Processing failed.";
      await supabase
        .from("documents")
        .update({ status: "failed", error_message: message })
        .eq("id", doc.id);
      throw new Error(message);
    }
  });

const AskInput = z.object({
  question: z.string().min(1).max(2000),
  conversationId: z.string().uuid().nullable(),
});

export const askQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AskInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = getLovableApiKey();

    let conversationId = data.conversationId;
    if (!conversationId) {
      const { data: conv, error } = await supabase
        .from("conversations")
        .insert({
          user_id: userId,
          title: data.question.slice(0, 60),
        })
        .select("id")
        .single();
      if (error || !conv) throw new Error(error?.message ?? "Could not start conversation.");
      conversationId = conv.id;
    }

    await supabase.from("messages").insert({
      conversation_id: conversationId,
      user_id: userId,
      role: "user",
      content: data.question,
    });

    const [queryVector] = await embedTexts(apiKey, [data.question]);
    const { data: matches, error: matchError } = await supabase.rpc("match_document_chunks", {
      query_embedding: JSON.stringify(queryVector),
      match_count: 8,
    });
    if (matchError) throw new Error(matchError.message);

    const retrieved = ((matches ?? []) as RetrievedChunk[]).filter((c) => c.similarity > 0.25);

    let answer: string;
    if (retrieved.length === 0) {
      answer =
        "I couldn't find anything about this in your uploaded materials. Try uploading the relevant notes, book chapter or PDF first — I only answer from your own knowledge sources.";
    } else {
      const provider = createResponsesProvider(apiKey);
      const result = streamText({
        model: provider.responses("openai/gpt-5.6-sol"),
        system: RAG_SYSTEM_PROMPT,
        prompt: `Retrieved excerpts from the student's materials:\n\n${buildContextBlock(
          retrieved,
        )}\n\nQuestion: ${data.question}`,
        providerOptions: { openai: { store: false } },
      });
      answer = (await result.text).trim();
      if (!answer) answer = "I couldn't generate an answer for that. Please rephrase your question.";
    }

    const citations = retrieved.map((c, i) => ({
      marker: i + 1,
      documentId: c.document_id,
      fileName: c.file_name,
      page: c.page_number,
      subject: c.subject,
      snippet: c.content.slice(0, 220),
      confidence: Math.round(c.similarity * 100),
    }));

    const { data: saved, error: saveError } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        user_id: userId,
        role: "assistant",
        content: answer,
        citations,
      })
      .select("id, created_at")
      .single();
    if (saveError) throw new Error(saveError.message);

    await supabase
      .from("conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);

    return { conversationId, messageId: saved.id, answer, citations };
  });