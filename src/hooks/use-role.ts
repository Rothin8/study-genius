import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "student" | "teacher" | "admin";

export function useRoles() {
  const { data, isLoading } = useQuery({
    queryKey: ["my-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("role");
      if (error) throw error;
      return (data ?? []).map((r) => r.role as AppRole);
    },
    staleTime: 60_000,
  });

  const roles = data ?? [];
  return {
    roles,
    loading: isLoading,
    isTeacher: roles.includes("teacher"),
    isAdmin: roles.includes("admin"),
    isStudent: roles.includes("student"),
  };
}
