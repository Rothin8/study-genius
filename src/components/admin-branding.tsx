import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useBranding, type Branding } from "@/hooks/use-branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Palette, RotateCcw } from "lucide-react";

type Form = {
  app_name: string;
  tagline: string;
  logo_url: string;
  favicon_url: string;
  primary_color: string;
  background_color: string;
  accent_color: string;
};

function toForm(branding: Branding): Form {
  return {
    app_name: branding.app_name ?? "",
    tagline: branding.tagline ?? "",
    logo_url: branding.logo_url ?? "",
    favicon_url: branding.favicon_url ?? "",
    primary_color: branding.primary_color ?? "",
    background_color: branding.background_color ?? "",
    accent_color: branding.accent_color ?? "",
  };
}

const COLOR_FIELDS: [keyof Form, string, string][] = [
  ["primary_color", "Primary", "#7c5cff"],
  ["background_color", "Background", "#0b0b12"],
  ["accent_color", "Accent", "#1b1b2b"],
];

export function AdminBranding() {
  const branding = useBranding();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => toForm(branding));

  useEffect(() => {
    setForm(toForm(branding));
  }, [branding]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("admin_update_branding", {
        _app_name: form.app_name,
        _tagline: form.tagline,
        _logo_url: form.logo_url,
        _favicon_url: form.favicon_url,
        _primary_color: form.primary_color,
        _background_color: form.background_color,
        _accent_color: form.accent_color,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Branding saved and applied site-wide.");
      queryClient.invalidateQueries({ queryKey: ["branding"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Could not save branding."),
  });

  function set(key: keyof Form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <section className="glass rounded-3xl p-6">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Palette className="size-4 text-primary" /> Branding
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Name, logo, favicon and theme colours. Colours accept any CSS colour value and apply to
        every page immediately after saving.
      </p>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="brand-name">App name</Label>
          <Input
            id="brand-name"
            value={form.app_name}
            onChange={(e) => set("app_name", e.target.value)}
            placeholder="Solution.AI"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brand-tagline">Tagline</Label>
          <Input
            id="brand-tagline"
            value={form.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="Solutions at your fingertips"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brand-logo">Logo image URL</Label>
          <Input
            id="brand-logo"
            value={form.logo_url}
            onChange={(e) => set("logo_url", e.target.value)}
            placeholder="https://…/logo.png"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="brand-favicon">Favicon URL</Label>
          <Input
            id="brand-favicon"
            value={form.favicon_url}
            onChange={(e) => set("favicon_url", e.target.value)}
            placeholder="https://…/favicon.png"
          />
        </div>

        {COLOR_FIELDS.map(([key, label, placeholder]) => (
          <div key={key} className="space-y-2">
            <Label htmlFor={`brand-${key}`}>{label} colour</Label>
            <div className="flex items-center gap-2">
              <span
                className="size-9 shrink-0 rounded-lg border border-border"
                style={{ background: form[key] || "transparent" }}
                aria-hidden
              />
              <Input
                id={`brand-${key}`}
                value={form[key]}
                onChange={(e) => set(key, e.target.value)}
                placeholder={placeholder}
                className="font-mono"
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="size-4 animate-spin" />}
          Save branding
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            setForm({
              app_name: "Solution.AI",
              tagline: "",
              logo_url: "",
              favicon_url: "",
              primary_color: "",
              background_color: "",
              accent_color: "",
            })
          }
        >
          <RotateCcw className="size-4" /> Reset to defaults
        </Button>
      </div>

      {form.logo_url && (
        <div className="mt-5 flex items-center gap-3 rounded-2xl border border-border p-4">
          <img src={form.logo_url} alt="Logo preview" className="h-10 w-auto" />
          <div>
            <p className="font-medium">{form.app_name || "Solution.AI"}</p>
            {form.tagline && <p className="text-xs text-muted-foreground">{form.tagline}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
