import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Copy, Ticket } from "lucide-react";

type AdminUser = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  roles: string[] | null;
  plan: string | null;
  documents_count: number;
  questions_count: number;
  created_at: string;
  last_sign_in_at: string | null;
};

type Invite = {
  id: string;
  code: string;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
};

export function AdminUsers({ currentUserId }: { currentUserId: string | undefined }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_users");
      if (error) throw error;
      return (data ?? []) as unknown as AdminUser[];
    },
  });

  const { data: invites } = useQuery({
    queryKey: ["teacher-invites"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_invites")
        .select("id, code, max_uses, used_count, expires_at")
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as Invite[];
    },
  });

  const setRole = useMutation({
    mutationFn: async (vars: { userId: string; role: "teacher" | "admin"; grant: boolean }) => {
      const { error } = await supabase.rpc("admin_set_role", {
        _target_user_id: vars.userId,
        _role: vars.role,
        _grant: vars.grant,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Roles updated.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["my-roles"] });
      queryClient.invalidateQueries({ queryKey: ["platform-stats"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not change the role."),
  });

  const setPlan = useMutation({
    mutationFn: async (vars: { userId: string; plan: "free" | "pro" }) => {
      const { error } = await supabase.rpc("admin_set_plan", {
        _target_user_id: vars.userId,
        _plan: vars.plan,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Plan updated.");
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["my-usage"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not change the plan."),
  });

  const createInvite = useMutation({
    mutationFn: async () => {
      if (!currentUserId) throw new Error("Not signed in.");
      const { error } = await supabase
        .from("teacher_invites")
        .insert({ created_by: currentUserId, max_uses: 1 });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Invite code created.");
      queryClient.invalidateQueries({ queryKey: ["teacher-invites"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not create an invite."),
  });

  const term = search.trim().toLowerCase();
  const shown = (users ?? []).filter(
    (u) =>
      !term ||
      (u.email ?? "").toLowerCase().includes(term) ||
      (u.display_name ?? "").toLowerCase().includes(term),
  );

  return (
    <>
      <section className="glass mt-6 rounded-3xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Users &amp; roles
          </h2>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="max-w-56"
          />
        </div>

        {isLoading && <Skeleton className="mt-4 h-24 w-full rounded-2xl" />}

        {!isLoading && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-150 text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr>
                  <th className="py-2 text-left">User</th>
                  <th className="py-2 text-left">Roles</th>
                  <th className="py-2 text-left">Plan</th>
                  <th className="py-2 text-right">Docs</th>
                  <th className="py-2 text-right">Questions</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((u) => {
                  const roles = u.roles ?? [];
                  const isTeacher = roles.includes("teacher");
                  const isAdmin = roles.includes("admin");
                  const busy = setRole.isPending && setRole.variables?.userId === u.user_id;
                  const plan = u.plan === "pro" ? "pro" : "free";
                  const planBusy = setPlan.isPending && setPlan.variables?.userId === u.user_id;
                  return (
                    <tr key={u.user_id} className="border-t border-border align-middle">
                      <td className="py-2.5">
                        <p className="font-medium">{u.display_name ?? "User"}</p>
                        <p className="text-xs text-muted-foreground">{u.email}</p>
                      </td>
                      <td className="py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {roles.length === 0 && <span className="text-muted-foreground">—</span>}
                          {roles.map((role) => (
                            <Badge key={role} variant={role === "admin" ? "default" : "secondary"}>
                              {role}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td className="py-2.5">
                        <Button
                          size="sm"
                          variant={plan === "pro" ? "default" : "secondary"}
                          disabled={planBusy}
                          onClick={() =>
                            setPlan.mutate({
                              userId: u.user_id,
                              plan: plan === "pro" ? "free" : "pro",
                            })
                          }
                        >
                          {planBusy && <Loader2 className="size-3 animate-spin" />}
                          {plan === "pro" ? "Pro" : "Free"}
                        </Button>
                      </td>
                      <td className="py-2.5 text-right">{u.documents_count}</td>
                      <td className="py-2.5 text-right">{u.questions_count}</td>
                      <td className="py-2.5">
                        <span className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              setRole.mutate({
                                userId: u.user_id,
                                role: "teacher",
                                grant: !isTeacher,
                              })
                            }
                          >
                            {busy && <Loader2 className="size-3 animate-spin" />}
                            {isTeacher ? "Remove teacher" : "Make teacher"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy || (isAdmin && u.user_id === currentUserId)}
                            onClick={() =>
                              setRole.mutate({ userId: u.user_id, role: "admin", grant: !isAdmin })
                            }
                          >
                            {isAdmin ? "Remove admin" : "Make admin"}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="glass mt-6 rounded-3xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            <Ticket className="size-4" /> Teacher invite codes
          </h2>
          <Button size="sm" disabled={createInvite.isPending} onClick={() => createInvite.mutate()}>
            {createInvite.isPending && <Loader2 className="size-3 animate-spin" />}
            New code
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          A student redeems a code on the Classes page to become a teacher.
        </p>
        <div className="mt-4 space-y-2">
          {(invites?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">No invite codes yet.</p>
          )}
          {invites?.map((invite) => (
            <div
              key={invite.id}
              className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
            >
              <code className="font-mono text-sm">{invite.code}</code>
              <span className="text-xs text-muted-foreground">
                {invite.used_count}/{invite.max_uses} used
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  void navigator.clipboard.writeText(invite.code);
                  toast.success("Code copied.");
                }}
              >
                <Copy className="size-3" /> Copy
              </Button>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}