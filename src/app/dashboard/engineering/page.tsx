import { redirect } from "next/navigation";
import { getEngineeringViewResolution } from "@/lib/auth/engineering-view.server";

export default async function EngineeringRoot() {
  const { surface } = await getEngineeringViewResolution();
  if (surface === "a-side") {
    redirect("/dashboard/engineering/delivery-health");
  }
  // B-side: layout renders EngineeringBRoot in place of children.
  return null;
}
