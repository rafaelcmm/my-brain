import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import { LogoutButton } from "@/app/(authed)/logout-button";
import {
  getSessionCsrfToken,
  resolveSessionBearer,
} from "@/lib/composition/auth";

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
  const session = await resolveSessionBearer();
  if (!session) {
    redirect("/login");
  }

  const csrfToken = await getSessionCsrfToken(session.sessionId);

  return (
    <>
      {/* Emit CSRF token in <head> so document.querySelector works from any context. */}
      <head>
        <meta name="mybrain-csrf-token" content={csrfToken} />
      </head>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-4 text-sm font-medium text-gray-700">
              <Link href="/dashboard" className="hover:text-gray-900">
                Dashboard
              </Link>
              <Link href="/memories" className="hover:text-gray-900">
                Memories
              </Link>
              <Link href="/editor" className="hover:text-gray-900">
                Editor
              </Link>
              <Link href="/query" className="hover:text-gray-900">
                Query
              </Link>
              <Link href="/graph" className="hover:text-gray-900">
                Graph
              </Link>
            </nav>
            <LogoutButton />
          </div>
        </header>
        {children}
      </div>
    </>
  );
}
