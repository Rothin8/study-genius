import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { useBranding } from "@/hooks/use-branding";
import { ArrowRight, BookOpenCheck, FileSearch, Quote, ShieldCheck, Upload } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Solution.AI — Cited AI Answers From Your Own Notes" },
      {
        name: "description",
        content:
          "Upload your books, notes and PDFs. Solution.AI retrieves the exact passages and answers with page-level citations — never made-up content.",
      },
      { property: "og:title", content: "Solution.AI — Cited AI Answers From Your Own Notes" },
      {
        property: "og:description",
        content: "A RAG study assistant grounded in your own documents.",
      },
    ],
  }),
  component: Landing,
});

const STEPS = [
  {
    icon: Upload,
    title: "Upload your material",
    body: "PDFs, DOCX and notes are parsed page by page, cleaned and split into retrievable passages.",
  },
  {
    icon: FileSearch,
    title: "Semantic retrieval",
    body: "Every passage is embedded into a vector index, so the right pages surface for any question.",
  },
  {
    icon: Quote,
    title: "Answers with citations",
    body: "Responses quote your own sources with file, page number and a confidence score.",
  },
];

function Landing() {
  const { session } = useSession();
  const branding = useBranding();
  const target = session ? "/chat" : "/auth";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between px-5 md:px-8">
        <div className="flex items-center gap-2">
          {branding.logo_url ? (
            <img src={branding.logo_url} alt={branding.app_name} className="h-9 w-auto" />
          ) : (
            <span className="flex size-10 rotate-2 items-center justify-center rounded-md bg-primary font-display text-lg font-bold text-primary-foreground shadow-glow">
              <span className="-rotate-2">S</span>
            </span>
          )}
          <div>
            <span className="block font-display text-lg font-bold text-primary">{branding.app_name}</span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">Your Study Buddy</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to="/pricing">Pricing</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to={target}>{session ? "Open app" : "Sign in"}</Link>
          </Button>
        </div>
        </div>
      </header>

      <main>
        <section className="hero-bg border-b border-border">
          <div className="mx-auto grid min-h-[calc(100svh-4.5rem)] max-w-6xl items-center gap-12 px-5 py-14 md:px-8 lg:grid-cols-[1.05fr_.95fr] lg:py-20">
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-accent px-3 py-1.5 text-xs font-semibold text-accent-foreground">
                <ShieldCheck className="size-3.5" />
                Answers grounded in your own materials
              </span>
              <h1 className="mt-7 text-5xl leading-[1.02] font-bold sm:text-6xl lg:text-7xl">
                Master Your Studies with <span className="text-primary">AI</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-muted-foreground">
                {branding.tagline ?? "Your personal study partner for clear answers, useful explanations, and page-level citations from the materials you trust."}
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="h-13 px-7 text-base shadow-glow">
                  <Link to={target}>
                    Get Started
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="secondary" className="h-13 border border-border px-7 text-base">
                  <Link to="/pricing">View Plans</Link>
                </Button>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-lg" aria-label="Solution.AI answer preview">
              <div className="rounded-lg border border-border bg-card p-4 shadow-soft sm:p-6">
                <div className="flex items-center justify-between border-b border-border pb-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">S</span>
                    <div><p className="text-sm font-semibold">Solution.AI</p><p className="text-xs text-muted-foreground">Studying Biology notes</p></div>
                  </div>
                  <span className="size-2 rounded-full bg-primary" />
                </div>
                <div className="space-y-4 py-6">
                  <div className="ml-auto max-w-[82%] rounded-lg bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                    Can you explain photosynthesis in simple terms?
                  </div>
                  <div className="max-w-[92%] text-sm leading-6 text-foreground">
                    Plants use sunlight to turn water and carbon dioxide into glucose, storing the sun’s energy as food.
                    <div className="mt-3 flex flex-wrap gap-2">
                      <span className="rounded-md border border-primary/20 bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">Biology.pdf · p. 24</span>
                      <span className="rounded-md border border-primary/20 bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">98% match</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-input bg-background px-4 py-3 text-sm text-muted-foreground">
                  Ask from your materials…
                  <span className="ml-auto flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground"><ArrowRight className="size-4" /></span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="bg-secondary py-20">
          <div className="mx-auto max-w-6xl px-5 md:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">HOW IT WORKS</p>
              <h2 className="mt-3 text-3xl font-bold sm:text-4xl">From your notes to a trusted answer</h2>
            </div>
            <div className="mt-10 grid border-y border-border md:grid-cols-3">
              {STEPS.map((step, index) => (
                <article key={step.title} className="border-b border-border py-8 md:border-r md:border-b-0 md:px-8 md:first:pl-0 md:last:border-r-0">
                  <div className="flex items-center justify-between">
                    <span className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground"><step.icon className="size-5" /></span>
                    <span className="font-display text-sm font-bold text-muted-foreground">0{index + 1}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold">{step.title}</h3>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-border bg-background py-20">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 md:flex-row md:items-center md:px-8">
            <div className="max-w-2xl">
              <span className="flex size-12 items-center justify-center rounded-md bg-accent text-primary"><BookOpenCheck className="size-6" /></span>
              <h2 className="mt-5 text-3xl font-bold sm:text-4xl">Study with the source in sight</h2>
              <p className="mt-3 leading-7 text-muted-foreground">Every answer points back to the exact file and page, so you can verify the context and keep learning with confidence.</p>
            </div>
            <Button asChild size="lg"><Link to={target}>Open your study space <ArrowRight className="size-4" /></Link></Button>
          </div>
        </section>
      </main>

      <footer className="px-5 py-8 text-center text-xs text-muted-foreground">
        {branding.app_name} — answers grounded in your own study materials
      </footer>
    </div>
  );
}
