import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { generateObject } from "ai";
import { createResponsesProvider, getLovableApiKey } from "@/lib/ai-gateway.server";
import { STUDY_SYSTEM_PROMPT, studyInstruction } from "@/lib/study.server";

const Input = z.object({
  documentId: z.string().uuid(),
  mode: z.enum(["quiz", "flashcards", "summary"]),
  count: z.number().int().min(3).max(15).default(8),
});

const StudySet = z.object({
  title: z.string(),
  quiz: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()),
        answerIndex: z.number().int(),
        explanation: z.string(),
        page: z.number().int().nullable(),
      }),
    )
    .default([]),
  flashcards: z
    .array(z.object({ front: z.string(), back: z.string(), page: z.number().int().nullable() }))
    .default([]),
  summary: z
    .array(z.object({ heading: z.string(), body: z.string(), page: z.number().int().nullable() }))
    .default([]),
});

export const generateStudySet = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { error: quotaError } = await supabase.rpc("consume_usage", {
      _kind: "question",
      _amount: 1,
    });
    if (quotaError) throw new Error(quotaError.message);

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, file_name")
      .eq("id", data.documentId)
      .maybeSingle();
    if (docError) throw new Error(docError.message);
    if (!doc) throw new Error("Document not found.");

    const { data: chunks, error: chunkError } = await supabase
      .from("document_chunks")
      .select("content, page_number, chunk_index")
      .eq("document_id", data.documentId)
      .order("chunk_index", { ascending: true })
      .limit(45);
    if (chunkError) throw new Error(chunkError.message);
    if (!chunks?.length) throw new Error("This document has no indexed text yet.");

    const excerpts = chunks
      .map((c) => `${c.page_number ? `[Page ${c.page_number}] ` : ""}${c.content}`)
      .join("\n\n---\n\n");

    const provider = createResponsesProvider(getLovableApiKey());
    const result = await generateObject({
      model: provider.responses("openai/gpt-5.6-sol"),
      schema: StudySet,
      system: STUDY_SYSTEM_PROMPT,
      prompt: `Document: ${doc.file_name}\n\nExcerpts:\n\n${excerpts}\n\nTask: ${studyInstruction(
        data.mode,
        data.count,
      )}\nFill only the field for this task ("${data.mode}") and leave the others empty.`,
    });

    return { mode: data.mode, fileName: doc.file_name, set: result.object };
  });
