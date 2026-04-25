"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

interface MemoriesPaginationControlsProps {
  readonly hasPrevious: boolean;
  readonly nextPageUrl: string | null;
}

/**
 * Renders cursor pagination controls for the memories list route.
 *
 * Why router.back for previous: cursor pagination only guarantees next cursors
 * from the API, so browser history is the most reliable way to return to the
 * prior viewed result page without guessing previous cursor tokens.
 */
export function MemoriesPaginationControls({
  hasPrevious,
  nextPageUrl,
}: MemoriesPaginationControlsProps) {
  const router = useRouter();

  if (!hasPrevious && !nextPageUrl) {
    return null;
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className={`px-4 py-2 rounded border ${hasPrevious ? "border-slate-300 bg-white text-slate-800 hover:bg-slate-50" : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"}`}
        onClick={() => router.back()}
        disabled={!hasPrevious}
      >
        Previous page
      </button>

      {nextPageUrl ? (
        <Link
          className="inline-block ds-btn-primary px-4 py-2"
          href={nextPageUrl}
        >
          Next page
        </Link>
      ) : null}
    </div>
  );
}
