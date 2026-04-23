"use client";

import { useRouter } from "next/navigation";
import { readCsrfTokenFromMeta } from "@/lib/application/csrf-client";

/**
 * Logout action executed with explicit CSRF header.
 */
export function LogoutButton() {
  const router = useRouter();

  async function handleLogout(): Promise<void> {
    const csrfToken = readCsrfTokenFromMeta();
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      headers: {
        "x-csrf-token": csrfToken,
      },
    });

    if (response.ok) {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={handleLogout} className="text-sm px-3 py-1.5 rounded bg-gray-900 text-white">
      Logout
    </button>
  );
}
