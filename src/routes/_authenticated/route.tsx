import { createFileRoute, Outlet, useNavigate, Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import { useRoles } from "@/hooks/use-role";
import { rememberRedirect, sanitizeRedirect } from "@/lib/auth-redirect";
import { Button } from "@/components/ui/button";
import { UsageMeter } from "@/components/usage-meter";
import {
  MessageSquare,
  Library,
  Loader2,
  LogOut,
  Users,
  BarChart3,
  GraduationCap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AppShell,
});

function AppShell() {
  const { session, user, loading } = useSession();
  const { isTeacher, isAdmin } = useRoles();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const href = useRouterState({ select: (s) => s.location.href });
  const bounced = useRef(false);

  useEffect(() => {
    if (loading || session || bounced.current) return;
    bounced.current = true;
    const safe = sanitizeRedirect(href);
    if (safe) rememberRedirect(safe);
    navigate({
      to: "/auth",
      search: { redirect: safe ?? undefined },
      replace: true,
    });
  }, [loading, session, navigate, href]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", search: { redirect: undefined }, replace: true });
  }

  const nav = [
    { to: "/chat", label: "AI Chat", icon: MessageSquare },
    { to: "/library", label: "My Documents", icon: Library },
    { to: "/study", label: "Study Tools", icon: GraduationCap },
    { to: "/classes", label: isTeacher ? "My Classes" : "Classes", icon: Users },
    ...(isAdmin ? [{ to: "/admin", label: "Analytics", icon: BarChart3 }] : []),
  ] as const;

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-secondary md:flex-row">
      <aside className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-sidebar-border bg-sidebar px-4 py-3 md:h-screen md:w-64 md:flex-col md:items-stretch md:justify-start md:border-r md:border-b-0 md:py-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-8 rotate-2 items-center justify-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground shadow-glow">
            <span className="-rotate-2">S</span>
          </span>
          <span className="font-display font-bold text-primary">Solution.AI</span>
        </Link>

        <nav className="flex gap-1 md:mt-8 md:flex-col">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                pathname === item.to && "bg-accent text-accent-foreground",
              )}
            >
              <item.icon className="size-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </Link>
          ))}
        </nav>

        <div className="md:mt-auto md:space-y-2">
          <UsageMeter />
          <p className="hidden truncate text-xs text-muted-foreground md:block">{user?.email}</p>
          <Button variant="ghost" size="sm" onClick={signOut} className="text-muted-foreground">
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </aside>

      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}