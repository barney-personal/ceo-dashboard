import { redirect } from "next/navigation";

export default function DeliveryRedirect() {
  // Moved into the unified Engineering view. Kept for bookmarked links.
  redirect("/dashboard/engineering/delivery-health");
}
