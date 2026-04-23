import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { LogoutButton } from "@/app/(authed)/logout-button";
import { getSessionStore } from "@/lib/infrastructure/session/store";

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

  const bearer = await getSessionStore().getBearer(sessionId);
  if (!bearer) {
    redirect("/login");
  }

  const csrfToken = await getSessionStore().getCSRFToken(sessionId);

  return (
    <div className="min-h-screen bg-gray-50">
      <meta name="mybrain-csrf-token" content={csrfToken} />
      <header className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <nav className="flex items-center gap-4 text-sm font-medium text-gray-700">
            <a href="/dashboard" className="hover:text-gray-900">Dashboard</a>
            <a href="/memories" className="hover:text-gray-900">Memories</a>
            <a href="/editor" className="hover:text-gray-900">Editor</a>
            <a href="/query" className="hover:text-gray-900">Query</a>
            <a href="/graph" className="hover:text-gray-900">Graph</a>
          </nav>
          <LogoutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
