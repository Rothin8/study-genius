import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const IdInput = z.object({ documentId: z.string().uuid() });

/** Deletes a document, its indexed passages and the stored original file. */
export const deleteDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => IdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: doc, error } = await supabase
      .from("documents")
      .select("id, storage_path, user_id")
      .eq("id", data.documentId)
      .single();
    if (error || !doc) throw new Error("Document not found.");
    if (doc.user_id !== userId) throw new Error("You can only delete your own documents.");

    if (doc.storage_path) {
      const { error: storageError } = await supabase.storage
        .from("documents")
        .remove([doc.storage_path]);
      if (storageError) throw new Error(storageError.message);
    }

    const { error: deleteError } = await supabase.from("documents").delete().eq("id", doc.id);
    if (deleteError) throw new Error(deleteError.message);

    return { ok: true };
  });