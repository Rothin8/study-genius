import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { takeRedirect } from "@/lib/auth-redirect";

export const Route = createFileRoute("/auth_/callback")({
  ssr: false,
  component: AuthCallback,
});

function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    async function run() {
      for (let attempt = 0; attempt < 40; attempt++) {
        const { data } = await supabase.auth.getSession();
        if (cancelled) return;
        if (data.session) {
          navigate({ to: takeRedirect(), replace: true });
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      if (!cancelled) navigate({ to: "/auth", replace: true });
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="hero-bg flex min-h-screen items-center justify-center">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}
