import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionStore } from "@/lib/infrastructure/session/store";

/**
 * Landing route forwards authenticated users to dashboard,
 * otherwise sends to login.
 */
export default async function HomePage(): Promise<never> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    redirect("/login");
  }

  const bearer = await getSessionStore().getBearer(sessionId);
  if (!bearer) {
    redirect("/login");
  }

  redirect("/dashboard");
}
