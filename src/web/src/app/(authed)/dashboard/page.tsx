import { GetBrainSummaryUseCase } from "@/lib/application/get-brain-summary.usecase";
import { getAuthenticatedClient } from "@/lib/composition/auth";
import { Breadcrumbs } from "@/app/(authed)/breadcrumbs";
import Link from "next/link";
import type { TopEntry } from "@/lib/domain";
import type { Metadata } from "next";
import type { ReactNode } from "react";

const ITEMS_PER_PAGE = 10;

export const metadata: Metadata = {
  title: "Dashboard",
};

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

/**
 * Normalizes machine-formatted metric keys into human-readable card labels.
 */
function toTitleLabel(value: string): string {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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
  const degraded = !capabilities.data.capabilities.engine;
  const cardLabelClass = "ds-card-title";
  const cardMetricClass = "ds-card-metric";

  return (
    <main className="ds-page-shell px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <Breadcrumbs items={[{ label: "Dashboard" }]} />
        <h1 className="text-3xl font-extrabold text-slate-900">Dashboard</h1>

        {degraded ? (
          <section className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
            <p className="font-semibold">Engine degraded mode active</p>
            <p className="text-sm">
              Orchestrator reports fallback mode; recall quality may be reduced.
            </p>
          </section>
        ) : null}

        <div className="ds-card-masonry md:columns-2 xl:columns-3">
          <div className="ds-card-masonry-item">
            <div className="ds-card">
              <p className={cardLabelClass}>Total memories</p>
              <p className={`${cardMetricClass} text-[#2E3192]`}>
                {summary.total_memories}
              </p>
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card">
              <p className={cardLabelClass}>Scopes tracked</p>
              <p className={`${cardMetricClass} text-[#00ADEF]`}>
                {Object.keys(summary.by_scope).length}
              </p>
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card">
              <p className={cardLabelClass}>Types tracked</p>
              <p className={`${cardMetricClass} text-slate-900`}>
                {Object.keys(summary.by_type).length}
              </p>
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card space-y-2">
              <p className={cardLabelClass}>Top tags</p>
              {renderTopEntryList(topTags.slice(0, 5), "No tags yet")}
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card space-y-2">
              <p className={cardLabelClass}>Top frameworks</p>
              {renderTopEntryList(
                topFrameworks.slice(0, 5),
                "No frameworks yet",
              )}
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card space-y-2">
              <p className={cardLabelClass}>Top languages</p>
              {renderTopEntryList(topLanguages.slice(0, 5), "No languages yet")}
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card space-y-2">
              <p className={cardLabelClass}>Capabilities</p>
              <p className="text-sm text-slate-700">
                Engine: {capabilities.data.capabilities.engine ? "on" : "off"}
              </p>
              <p className="text-sm text-slate-700">
                Vector DB: {capabilities.data.features.vectorDb ? "on" : "off"}
              </p>
              <p className="text-sm text-slate-700">
                SONA: {capabilities.data.features.sona ? "on" : "off"}
              </p>
              <p className="text-sm text-slate-700">
                Attention: {capabilities.data.features.attention ? "on" : "off"}
              </p>
            </div>
          </div>

          <div className="ds-card-masonry-item">
            <div className="ds-card ds-card-accent space-y-2">
              <p className={cardLabelClass}>Learning stats</p>
              {learningEntries.length === 0 ? (
                <p className="text-sm text-slate-600">
                  No learning signals yet
                </p>
              ) : (
                <ul className="space-y-2 text-sm text-slate-800">
                  {learningEntries.map(([label, count]) => (
                    <li key={label} className="flex justify-between gap-3">
                      <span className="truncate">{toTitleLabel(label)}</span>
                      <span className="font-semibold text-slate-900">
                        {count}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        <section className="ds-card space-y-4">
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
            <Link
              className={`px-3 py-1 rounded ${clampedPage > 1 ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-400 pointer-events-none"}`}
              href={`?page=${clampedPage - 1}`}
            >
              Previous
            </Link>
            <Link
              className={`px-3 py-1 rounded ${clampedPage < insightPages ? "bg-gray-900 text-white" : "bg-gray-200 text-gray-400 pointer-events-none"}`}
              href={`?page=${clampedPage + 1}`}
            >
              Next
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
