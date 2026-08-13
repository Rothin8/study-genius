import { supabase } from "@/integrations/supabase/client";

/** Opens the stored original in a new tab, anchored to a page when the viewer supports it. */
export async function openStoredDocument(documentId: string, page?: number | null) {
  const { data: doc, error } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!doc?.storage_path) throw new Error("No stored original for this document.");

  const { data, error: signError } = await supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, 60);
  if (signError || !data) throw new Error(signError?.message ?? "Could not open the file.");

  const url = page ? `${data.signedUrl}#page=${page}` : data.signedUrl;
  window.open(url, "_blank", "noopener,noreferrer");
}
