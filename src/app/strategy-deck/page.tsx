import { redirect } from "next/navigation";
import { getCurrentUserRole } from "@/lib/auth/roles.server";
import { hasAccess } from "@/lib/auth/roles";
import { StrategyDeck } from "@/components/strategy-deck/strategy-deck";

export const metadata = {
  title: "Strategy · Cleo",
};

export default async function StrategyDeckPage() {
  const role = await getCurrentUserRole();
  if (!hasAccess(role, "everyone")) {
    redirect("/dashboard");
  }
  return <StrategyDeck />;
}
