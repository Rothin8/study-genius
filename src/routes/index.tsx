import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { useSession } from "@/hooks/use-session";
import { Sparkle, FileSearch, Quote, ShieldCheck, Upload, MessageSquare } from "lucide-react";

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
  const target = session ? "/chat" : "/auth";

  return (
    <div className="hero-bg min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-6 md:px-8">
        <div className="flex items-center gap-2">
          <span className="bg-gradient-accent flex size-9 items-center justify-center rounded-xl">
            <Sparkle className="size-5 text-primary-foreground" />
          </span>
          <span className="font-display text-lg font-semibold">Solution.AI</span>
        </div>
        <Button asChild variant="secondary" size="sm">
          <Link to={target}>{session ? "Open app" : "Sign in"}</Link>
        </Button>
      </header>

      <main>
        <section className="mx-auto max-w-3xl px-4 py-20 text-center md:px-8">
          <span className="glass inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-primary" />
            Grounded RAG — no hallucinated answers
          </span>
          <h1 className="mt-6 text-4xl leading-tight font-semibold md:text-6xl">
            Solutions at your <span className="text-gradient">fingertips</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-muted-foreground md:text-lg">
            Solution.AI turns your books, lecture notes and question papers into an AI study partner
            that answers strictly from your own material — with the page it came from.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to={target}>
                <MessageSquare className="size-4" />
                Start asking questions
              </Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link to={session ? "/library" : "/auth"}>Upload documents</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 pb-24 md:px-8">
          <div className="grid gap-4 md:grid-cols-3">
            {STEPS.map((step) => (
              <article key={step.title} className="glass rounded-3xl p-6">
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent">
                  <step.icon className="size-5 text-primary" />
                </span>
                <h2 className="mt-4 text-lg font-semibold">{step.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-4 py-8 text-center text-xs text-muted-foreground">
        Solution.AI — retrieval-augmented study assistant
      </footer>
    </div>
  );
}
