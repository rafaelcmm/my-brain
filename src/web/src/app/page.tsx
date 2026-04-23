import { redirect } from "next/navigation";
import { resolveSessionBearer } from "@/lib/composition/auth";

/**
 * Landing route forwards authenticated users to dashboard,
 * otherwise sends to login.
 */
export default async function HomePage(): Promise<never> {
  const session = await resolveSessionBearer();
  if (!session) {
    redirect("/login");
  }

  redirect("/dashboard");
}
