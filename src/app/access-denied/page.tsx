import Link from "next/link";
import { SignOutButton } from "@clerk/nextjs";
import { ArrowLeft } from "lucide-react";

export default function AccessDeniedPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <div className="space-y-4">
        <h1 className="font-display text-4xl tracking-tight text-foreground">
          Access restricted
        </h1>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          This dashboard is only available to <strong>@meetcleo.com</strong> email
          addresses. Please sign in with your Cleo account.
        </p>
      </div>

      <div className="mt-8 flex items-center gap-4">
        <SignOutButton redirectUrl="/">
          <button className="inline-flex items-center gap-2 rounded-full border border-border/50 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-border hover:text-foreground">
            <ArrowLeft className="h-3.5 w-3.5" />
            Sign out
          </button>
        </SignOutButton>
        <Link
          href="/sign-in"
          className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-xl hover:shadow-primary/25"
        >
          Sign in with Cleo
        </Link>
      </div>
    </div>
  );
}
