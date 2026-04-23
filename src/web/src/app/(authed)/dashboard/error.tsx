"use client";

/**
 * Dashboard route-level error boundary.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto rounded-lg border border-red-200 bg-red-50 p-6 space-y-3">
        <h1 className="text-xl font-bold text-red-900">
          Dashboard unavailable
        </h1>
        <p className="text-sm text-red-800">
          {error.message || "Unexpected error while loading dashboard."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="rounded bg-red-700 px-4 py-2 text-white"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
