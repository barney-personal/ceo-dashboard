import { redirect } from "next/navigation";

export default function SlackRoot() {
  redirect("/dashboard/slack/members");
}
