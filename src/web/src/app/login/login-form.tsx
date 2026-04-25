"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

/**
 * Interactive login form that exchanges token for server session.
 */
export function LoginForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        if (data.error === "Invalid or expired token") {
          setError("Token invalid. Verify token value and try again.");
        } else if (data.error === "Orchestrator unavailable") {
          setError("Orchestrator unavailable. Check stack status then retry.");
        } else {
          setError(data.error || "Login failed");
        }
        setLoading(false);
        return;
      }

      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setLoading(false);
    }
  };

  return (
    <div className="ds-page-shell flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="ds-card rounded-2xl px-6 py-7">
          <div className="flex justify-center">
            <Image
              src="/my-brain-logo.svg"
              alt="My Brain"
              width={56}
              height={56}
              priority
            />
          </div>
          <h2 className="mt-4 text-center text-3xl font-extrabold text-[#2E3192]">
            My Brain
          </h2>
          <p className="mt-2 text-center text-sm text-slate-600">
            Sign in with your orchestrator API token
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="rounded-md bg-red-50 p-4">
              <p className="text-sm font-medium text-red-800">{error}</p>
            </div>
          )}

          <div className="rounded-md shadow-sm -space-y-px">
            <label htmlFor="token" className="sr-only">
              API Token
            </label>
            <input
              id="token"
              name="mb_master_token_input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              className="ds-input appearance-none relative block w-full focus:z-10 sm:text-sm"
              placeholder="API Token"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              disabled={loading}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="group relative w-full flex justify-center py-2 px-4 text-sm rounded-md ds-btn-primary disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
