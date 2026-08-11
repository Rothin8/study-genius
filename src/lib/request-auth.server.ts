import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

function isNewApiKey(value: string) {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

/** Verifies the request bearer token and returns a Supabase client acting as that user. */
export async function authenticateRequest(request: Request) {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Backend is not configured.");

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) throw new Error("Unauthorized");
  const token = authHeader.slice("Bearer ".length);
  if (token.split(".").length !== 3) throw new Error("Unauthorized");

  const supabase = createClient<Database>(url, key, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (isNewApiKey(key) && headers.get("Authorization") === `Bearer ${key}`) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Unauthorized");

  return { supabase, userId: data.claims.sub as string };
}