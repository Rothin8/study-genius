import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { ocrImages } from "./ocr.server";
import { getLovableApiKey } from "./ai-gateway.server";

const OcrInput = z.object({
  images: z
    .array(z.string().startsWith("data:image/").max(8_000_000))
    .min(1)
    .max(10),
});

export const ocrPages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => OcrInput.parse(input))
  .handler(async ({ data }) => ({ texts: await ocrImages(getLovableApiKey(), data.images) }));
