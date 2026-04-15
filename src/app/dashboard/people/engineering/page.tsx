import { redirect } from "next/navigation";

export default async function PeopleEngineeringRedirect({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const params = await searchParams;
  const qs = params.period ? `?period=${encodeURIComponent(params.period)}` : "";
  redirect(`/dashboard/engineering/engineers${qs}`);
}
