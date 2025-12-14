import { redirect } from "next/navigation";

export default function Home() {
  // Go straight to the tracker
  redirect("/ai/portfolio-tracker");
}