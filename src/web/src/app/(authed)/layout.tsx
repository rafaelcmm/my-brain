import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Protected route group layout.
 * Verifies session cookie exists before rendering protected content.
 * Redirects unauthenticated users to /login.
 */
export default async function AuthedLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get("session")?.value;

  if (!sessionId) {
    redirect("/login");
  }

  return <>{children}</>;
}
