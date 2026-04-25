"use client";

import { useState } from "react";

type ViewMode = "markdown" | "raw";

interface MemoryContentToggleProps {
  readonly renderedMarkdown: string;
  readonly rawContent: string;
}

/**
 * Toggles memory content between rendered markdown and raw source modes.
 *
 * Why dual mode: users can verify markdown parsing behavior quickly while still
 * inspecting exact stored payload when diagnosing formatting issues.
 */
export function MemoryContentToggle({
  renderedMarkdown,
  rawContent,
}: MemoryContentToggleProps) {
  const [mode, setMode] = useState<ViewMode>("markdown");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-slate-500">
          Content
        </p>
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden">
          <button
            type="button"
            className={`px-3 py-1 text-xs font-semibold ${mode === "markdown" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
            onClick={() => setMode("markdown")}
          >
            Markdown
          </button>
          <button
            type="button"
            className={`px-3 py-1 text-xs font-semibold border-l border-slate-200 ${mode === "raw" ? "bg-slate-900 text-white" : "bg-white text-slate-700 hover:bg-slate-50"}`}
            onClick={() => setMode("raw")}
          >
            Raw
          </button>
        </div>
      </div>

      {mode === "markdown" ? (
        <article
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
        />
      ) : (
        <pre className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 whitespace-pre-wrap break-all overflow-auto">
          {rawContent}
        </pre>
      )}
    </section>
  );
}
