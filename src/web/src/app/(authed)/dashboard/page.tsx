import { GetBrainSummaryUseCase } from "@/lib/application/get-brain-summary.usecase";
import { getAuthenticatedClient } from "@/lib/composition/auth";
import type { TopEntry } from "@/lib/domain";
import type { ReactNode } from "react";

const ITEMS_PER_PAGE = 10;

function paginate<T>(items: T[], page: number): T[] {
  const start = (page - 1) * ITEMS_PER_PAGE;
  return items.slice(start, start + ITEMS_PER_PAGE);
}

function parsePage(value?: string): number {
  if (!value) {
    return 1;
  }

  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }

  return numeric;
}

function totalPages(items: unknown[]): number {
  return Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
}

function hasEngineFailureMode(mode: string): boolean {
  return mode.toLowerCase() !== "engine";
}

function renderTopEntryList(
  entries: Array<TopEntry & { label: string }>,
  emptyLabel: string,
): ReactNode {
  if (entries.length === 0) {
    return <p className="text-sm text-gray-500">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2 text-sm text-gray-800">
      {entries.map((entry) => (
        <li
          key={`${entry.label}:${entry.count}`}
          className="flex justify-between gap-3"
        >
          <span className="truncate">{entry.label}</span>
          <span className="font-semibold text-gray-900">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Dashboard page for authenticated users.
 *
 * Why fallback UI: this route must render even while deeper dashboard cards
 * are still under implementation, so users keep a stable landing page.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: {
    page?: string;
  };
}) {
  const client = await getAuthenticatedClient();
  if (!client) {
    return <div className="p-6">Unauthorized</div>;
  }

  const useCase = new GetBrainSummaryUseCase(client);
  const [summary, capabilities] = await Promise.all([
    useCase.execute(),
    client.getCapabilities(),
  ]);

  const page = parsePage(searchParams?.page);
  const topTags = summary.top_tags.map((entry) => ({
    label: entry.tag,
    count: entry.count,
  }));
  const topFrameworks = summary.top_frameworks.map((entry) => ({
    label: entry.framework,
    count: entry.count,
  }));
  const topLanguages = summary.top_languages.map((entry) => ({
    label: entry.language,
    count: entry.count,
  }));

  const combinedInsights = [
    ...topTags.map((entry) => ({ ...entry, kind: "tag" })),
    ...topFrameworks.map((entry) => ({ ...entry, kind: "framework" })),
    ...topLanguages.map((entry) => ({ ...entry, kind: "language" })),
  ];

  const insightPages = totalPages(combinedInsights);
  const clampedPage = Math.min(page, insightPages);
  const insightSlice = paginate(combinedInsights, clampedPage);

  const learningEntries = Object.entries(summary.learning_stats);
  const degraded = hasEngineFailureMode(capabilities.mode);

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">Dashboard</h1>

        {degraded ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <p className="font-semibold">Engine degraded mode active</p>
            <p className="text-sm">
              Orchestrator reports fallback mode; recall quality may be reduced.
            </p>
          </section>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Total memories</p>
            <p className="text-3xl font-extrabold text-blue-600">
              {summary.total_memories}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Scopes tracked</p>
            <p className="text-3xl font-extrabold text-green-600">
              {Object.keys(summary.by_scope).length}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Types tracked</p>
            <p className="text-3xl font-extrabold text-gray-900">
              {Object.keys(summary.by_type).length}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Top tags</p>
            {renderTopEntryList(topTags.slice(0, 5), "No tags yet")}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Top frameworks</p>
            {renderTopEntryList(topFrameworks.slice(0, 5), "No frameworks yet")}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Top languages</p>
            {renderTopEntryList(topLanguages.slice(0, 5), "No languages yet")}
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Capabilities</p>
            <p className="mt-2 text-sm text-gray-700">
              Version: {capabilities.version}
            </p>
            <p className="text-sm text-gray-700">Mode: {capabilities.mode}</p>
            <p className="text-sm text-gray-700">
              Distinct scopes: {Object.keys(summary.by_scope).length}
            </p>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-xs uppercase text-gray-500">Learning stats</p>
            {learningEntries.length === 0 ? (
              <p className="text-sm text-gray-500">No learning signals yet</p>
            ) : (
              <ul className="space-y-2 text-sm text-gray-800">
                {learningEntries.map(([label, count]) => (
                  <li key={label} className="flex justify-between gap-3">
                    <span className="truncate">{label}</span>
                    <span className="font-semibold text-gray-900">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <section className="bg-white rounded-lg shadow p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase text-gray-500">
              Insight feed
            </h2>
            <span className="text-xs text-gray-500">
              Page {clampedPage} / {insightPages}
            </span>
          </div>

          {insightSlice.length === 0 ? (
            <p className="text-sm text-gray-500">No insights yet</p>
          ) : (
            <ul className="divide-y">
              {insightSlice.map((entry) => (
                <li
                  key={`${entry.kind}:${entry.label}:${entry.count}`}
                  className="py-2 flex justify-between gap-3 text-sm"
                >
                  <span className="text-gray-700">
                    {entry.kind}:{" "}
                    <span className="font-medium text-gray-900">
                      {entry.label}
                    </span>
                  </span>
                  <span className="font-semibold text-gray-900">
                    {entry.count}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center justify-between gap-2 text-sm">
            <a
              className={`px-3 py-1 rounded ${clampedPage > 1 ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-400 pointer-events-none"}`}
              href={`?page=${clampedPage - 1}`}
            >
              Previous
            </a>
            <a
              className={`px-3 py-1 rounded ${clampedPage < insightPages ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-400 pointer-events-none"}`}
              href={`?page=${clampedPage + 1}`}
            >
              Next
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
