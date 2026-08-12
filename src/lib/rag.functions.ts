import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { chunkPages } from "./rag.server";
import { embedTexts, getLovableApiKey } from "./ai-gateway.server";

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

    // Plan limits are enforced in the database so the browser cannot bypass them.
    const { error: docQuota } = await supabase.rpc("consume_usage", {
      _kind: "document",
      _amount: 1,
    });
    if (docQuota) throw new Error(docQuota.message);
    const { error: pageQuota } = await supabase.rpc("consume_usage", {
      _kind: "pages",
      _amount: data.pages.length,
    });
    if (pageQuota) throw new Error(pageQuota.message);

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
