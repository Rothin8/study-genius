import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type Branding = {
  app_name: string;
  tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  background_color: string | null;
  accent_color: string | null;
};

export const DEFAULT_BRANDING: Branding = {
  app_name: "Solution.AI",
  tagline: null,
  logo_url: null,
  favicon_url: null,
  primary_color: null,
  background_color: null,
  accent_color: null,
};

/** Site-wide branding record (single row); readable by everyone, editable by admins. */
export function useBranding() {
  const { data } = useQuery({
    queryKey: ["branding"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_branding")
        .select(
          "app_name, tagline, logo_url, favicon_url, primary_color, background_color, accent_color",
        )
        .maybeSingle();
      if (error) throw error;
      return (data as Branding | null) ?? DEFAULT_BRANDING;
    },
  });

  return data ?? DEFAULT_BRANDING;
}

/** Applies branding colours, favicon and document title to the live page. */
export function useApplyBranding() {
  const branding = useBranding();

  useEffect(() => {
    const root = document.documentElement;
    const vars: [string, string | null][] = [
      ["--primary", branding.primary_color],
      ["--ring", branding.primary_color],
      ["--background", branding.background_color],
      ["--accent", branding.accent_color],
    ];

    for (const [name, value] of vars) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }

    if (branding.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.href = branding.favicon_url;
    }
  }, [branding]);

  return branding;
}
