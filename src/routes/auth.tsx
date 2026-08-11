import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkle, Loader2 } from "lucide-react";
import { rememberRedirect, sanitizeRedirect, takeRedirect } from "@/lib/auth-redirect";

export const Route = createFileRoute("/auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: typeof search['redirect'] === "string" ? search['redirect'] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — Solution.AI" },
      {
        name: "description",
        content: "Sign in to Solution.AI to upload your study materials and get cited AI answers.",
      },
      { property: "og:title", content: "Sign in — Solution.AI" },
      { property: "og:description", content: "Access your AI-powered study knowledge base." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectParam } = Route.useSearch();
  const { session, loading } = useSession();
  const [mode, setMode] = useState<"signin" | "signup" | "otp">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const destination = sanitizeRedirect(redirectParam) ?? null;

  useEffect(() => {
    if (destination) rememberRedirect(destination);
  }, [destination]);

  function goToDestination() {
    navigate({ to: takeRedirect(destination ?? "/chat"), replace: true });
  }

  useEffect(() => {
    if (!loading && session) goToDestination();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      if (mode === "otp") {
        if (!otpSent) {
          const { error } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
          });
          if (error) throw error;
          setOtpSent(true);
          toast.success("We emailed you a 6-digit code.");
          return;
        }
        const { error } = await supabase.auth.verifyOtp({
          email,
          token: otpCode.trim(),
          type: "email",
        });
        if (error) throw error;
        goToDestination();
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: { full_name: name },
          },
        });
        if (error) throw error;
        if (!data.session) {
          toast.success("Check your email to confirm your account.");
          return;
        }
        goToDestination();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        goToDestination();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setBusy(true);
    rememberRedirect(destination ?? "/chat");
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: `${window.location.origin}/auth/callback`,
    });
    if (result.error) {
      toast.error("Google sign-in failed. Please try again.");
      setBusy(false);
      return;
    }
    if (result.redirected) return;

    // The session is written asynchronously by the auth helper — wait for it
    // before navigating, otherwise the protected route bounces back here.
    for (let attempt = 0; attempt < 20; attempt++) {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        goToDestination();
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    toast.error("Signed in, but the session didn't load. Please refresh.");
    setBusy(false);
  }

  return (
    <main className="hero-bg flex min-h-screen items-center justify-center px-4 py-16">
      <div className="glass w-full max-w-md rounded-3xl p-8">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <span className="bg-gradient-accent flex size-9 items-center justify-center rounded-xl">
            <Sparkle className="size-5 text-primary-foreground" />
          </span>
          <span className="font-display text-lg font-semibold">Solution.AI</span>
        </Link>

        <h1 className="text-2xl font-semibold">
          {mode === "signup"
            ? "Create your account"
            : mode === "otp"
              ? "Sign in with a code"
              : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Solutions at your fingertips — answers only from your own materials.
        </p>
        {destination && (
          <p className="mt-2 text-xs text-primary">
            Sign in to continue to <span className="font-medium">{destination}</span>
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Aditi Sharma"
                autoComplete="name"
              />
            </div>
          )}
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground">
              Everyone starts as a student. Teachers get upgraded with an invite code from the
              Classes page after signing in.
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setOtpSent(false);
              }}
              placeholder="you@college.edu"
              autoComplete="email"
            />
          </div>
          {mode !== "otp" && (
            <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
            />
            </div>
          )}
          {mode === "otp" && otpSent && (
            <div className="space-y-2">
              <Label htmlFor="otp">6-digit code</Label>
              <Input
                id="otp"
                inputMode="numeric"
                required
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                autoComplete="one-time-code"
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === "signup"
              ? "Create account"
              : mode === "otp"
                ? otpSent
                  ? "Verify code"
                  : "Email me a code"
                : "Sign in"}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button variant="secondary" className="w-full" onClick={handleGoogle} disabled={busy}>
          Continue with Google
        </Button>

        <Button
          variant="ghost"
          className="mt-2 w-full"
          type="button"
          onClick={() => {
            setOtpSent(false);
            setOtpCode("");
            setMode(mode === "otp" ? "signin" : "otp");
          }}
          disabled={busy}
        >
          {mode === "otp" ? "Use password instead" : "Email me a one-time code"}
        </Button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signup" ? "Already have an account?" : "New to Solution.AI?"}{" "}
          <button
            type="button"
            className="text-primary underline-offset-4 hover:underline"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
          >
            {mode === "signup" ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </main>
  );
}