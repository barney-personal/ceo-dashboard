import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export default async function LandingPage() {
  const { userId } = await auth();

  if (userId) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight">CEO Dashboard</h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Company metrics, financials, people data, and OKRs — all in one place.
        </p>
        <Link
          href="/sign-in"
          className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
