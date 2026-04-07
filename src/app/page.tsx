import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden">
      {/* Background gradient washes */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-1/4 -top-1/4 h-[600px] w-[600px] rounded-full bg-primary/[0.04] blur-[120px]" />
        <div className="absolute -right-1/4 bottom-0 h-[500px] w-[500px] rounded-full bg-chart-3/[0.06] blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-8 text-center">
        {/* Subtle top rule */}
        <div className="h-px w-16 bg-gradient-to-r from-transparent via-primary/30 to-transparent" />

        <div className="space-y-4">
          <p className="text-xs font-medium uppercase tracking-[0.3em] text-muted-foreground">
            Command Centre
          </p>
          <h1 className="font-display text-6xl italic tracking-tight text-foreground md:text-7xl">
            Dashboard
          </h1>
        </div>

        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Financials, people, objectives — unified metrics
          <br />
          for executive decision-making.
        </p>

        <Link
          href="/sign-in"
          className="group mt-2 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-6 py-2.5 text-sm font-medium text-primary transition-all hover:border-primary/30 hover:bg-primary/10 hover:shadow-lg hover:shadow-primary/5"
        >
          Sign in
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </Link>

        {/* Bottom rule */}
        <div className="mt-4 h-px w-16 bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>
    </div>
  );
}
