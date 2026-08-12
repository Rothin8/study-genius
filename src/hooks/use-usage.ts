import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Usage = {
  plan: "free" | "pro";
  period: string;
  documents: number;
  pages: number;
  questions: number;
  limits: { documents: number; pages: number; questions: number };
};

export function useUsage() {
  return useQuery({
    queryKey: ["my-usage"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_usage");
      if (error) throw error;
      return data as unknown as Usage;
    },
    staleTime: 30_000,
  });
}
