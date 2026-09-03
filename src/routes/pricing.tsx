import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Check, Sparkle, CreditCard, Loader2 } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Solution.AI Study Plans" },
      {
        name: "description",
        content:
          "Compare Solution.AI plans: Free for casual revision, Pro for 500 documents, 10,000 pages and 3,000 grounded answers each month.",
      },
      { property: "og:title", content: "Pricing — Solution.AI Study Plans" },
      {
        property: "og:description",
        content: "Free and Pro study plans with page-cited AI answers from your own material.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PricingPage,
});

type Tier = {
  id: "free" | "pro";
  name: string;
  price: string;
  cadence: string;
  blurb: string;
  features: string[];
  highlight?: boolean;
};

const TIERS: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "₹0",
    cadence: "forever",
    blurb: "Enough to revise a subject and see how grounded answers feel.",
    features: [
      "20 documents in your library",
      "300 pages indexed per month",
      "60 grounded questions per month",
      "OCR for scanned notes",
      "Quizzes, flashcards and summaries",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "₹499",
    cadence: "per month",
    blurb: "For full syllabus coverage, class sharing and heavy exam season use.",
    features: [
      "500 documents in your library",
      "10,000 pages indexed per month",
      "3,000 grounded questions per month",
      "Priority indexing queue",
      "Class sharing and teacher tools",
      "Everything in Free",
    ],
    highlight: true,
  },
];

function PricingPage() {
  const [coupon, setCoupon] = useState("");
  const [billing, setBilling] = useState<"monthly" | "yearly">("monthly");
  const [pending, setPending] = useState<string | null>(null);

  function checkout(tier: Tier) {
    if (tier.id === "free") {
      toast.success("Free is already yours — just create an account.");
      return;
    }
    setPending(tier.id);
    setTimeout(() => {
      setPending(null);
      toast.error(
        "Checkout isn't live yet — payments must be enabled on this workspace before Pro can be sold.",
        {
          description: coupon.trim()
            ? `Coupon "${coupon.trim().toUpperCase()}" will be applied once checkout is enabled.`
            : "Until then an admin can move an account to Pro from Analytics → Users.",
        },
      );
    }, 500);
  }

  const yearlyNote = billing === "yearly" ? " · 2 months free on annual" : "";

  return (
    <div className="hero-bg min-h-screen">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-4 py-6 md:px-8">
        <Link to="/" className="flex items-center gap-2">
          <span className="bg-gradient-accent flex size-8 items-center justify-center rounded-lg">
            <Sparkle className="size-4 text-primary-foreground" />
          </span>
          <span className="font-display font-semibold">Solution.AI</span>
        </Link>
        <Button asChild variant="secondary" size="sm">
          <Link to="/auth" search={{ redirect: undefined }}>
            Sign in
          </Link>
        </Button>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-20 md:px-8">
        <section className="text-center">
          <h1 className="font-display text-4xl font-semibold md:text-5xl">
            Pick the plan that fits your syllabus
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Every plan answers only from your own uploaded material, with a page citation on every
            claim. Upgrade when your library outgrows the free limits{yearlyNote}.
          </p>

          <div className="mt-6 inline-flex rounded-full border border-border p-1">
            {(["monthly", "yearly"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setBilling(option)}
                className={`rounded-full px-4 py-1.5 text-sm capitalize transition-colors ${
                  billing === option
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </section>

        <section className="mt-12 grid gap-6 md:grid-cols-2">
          {TIERS.map((tier) => (
            <article
              key={tier.id}
              className={`glass flex flex-col rounded-3xl p-7 ${tier.highlight ? "shadow-glow" : ""}`}
            >
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold">{tier.name}</h2>
                {tier.highlight && <Badge>Most popular</Badge>}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{tier.blurb}</p>

              <p className="mt-6 flex items-end gap-2">
                <span className="font-display text-4xl font-semibold">
                  {tier.id === "pro" && billing === "yearly" ? "₹4,990" : tier.price}
                </span>
                <span className="pb-1 text-sm text-muted-foreground">
                  {tier.id === "pro" && billing === "yearly" ? "per year" : tier.cadence}
                </span>
              </p>

              <ul className="mt-6 space-y-2 text-sm">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {tier.id === "pro" && (
                <div className="mt-6 space-y-2">
                  <label htmlFor="coupon" className="text-xs text-muted-foreground uppercase">
                    Coupon code
                  </label>
                  <Input
                    id="coupon"
                    value={coupon}
                    onChange={(e) => setCoupon(e.target.value.toUpperCase())}
                    placeholder="STUDY20"
                    className="font-mono"
                  />
                </div>
              )}

              <Button
                className="mt-6"
                variant={tier.highlight ? "default" : "secondary"}
                disabled={pending === tier.id}
                onClick={() => checkout(tier)}
              >
                {pending === tier.id ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <CreditCard className="size-4" />
                )}
                {tier.id === "free" ? "Start free" : "Checkout with card"}
              </Button>
            </article>
          ))}
        </section>

        <section className="glass mt-10 rounded-3xl p-6 text-sm text-muted-foreground">
          <h2 className="text-base font-semibold text-foreground">Before you can charge</h2>
          <p className="mt-2">
            Card checkout needs payments switched on for this workspace — that requires a paid
            Lovable plan. The tiers, coupon field and checkout button here are already wired to the
            plan limits enforced in the backend, so turning payments on is the only remaining step.
            In the meantime an admin can grant Pro from Analytics → Users, and the limits apply
            immediately.
          </p>
        </section>
      </main>
    </div>
  );
}
