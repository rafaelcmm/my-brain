import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
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
      <div className="min-h-screen bg-slate-100">
        <header className="bg-white border-b border-slate-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
            <nav className="flex items-center gap-4 text-sm">
              <Link href="/dashboard" className="flex items-center gap-2 mr-2 text-[#2E3192] hover:text-[#1f2266]">
                <Image
                  src="/my-brain-logo.svg"
                  alt="My Brain"
                  width={28}
                  height={28}
                  priority
                />
                <span className="hidden sm:inline">My Brain</span>
              </Link>
                <Link href="/dashboard" className="ds-nav-link">
                Dashboard
              </Link>
                <Link href="/memories" className="ds-nav-link">
                Memories
              </Link>
                <Link href="/editor" className="ds-nav-link">
                Editor
              </Link>
                <Link href="/query" className="ds-nav-link">
                Query
              </Link>
                <Link href="/graph" className="ds-nav-link">
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
