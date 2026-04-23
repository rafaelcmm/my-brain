"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import CodeMirror from "@uiw/react-codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { z } from "zod";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { readCsrfTokenFromMeta } from "@/lib/application/csrf-client";

const draftStorageKey = "mybrain.editor.draft.v1";

const formSchema = z.object({
  content: z.string().min(1, "Content is required"),
  type: z.string().min(1),
  scope: z.string().min(1),
  repo: z.string().optional(),
  repo_name: z.string().optional(),
  language: z.string().optional(),
  frameworks: z.string().optional(),
  tags: z.string().optional(),
  path: z.string().optional(),
  symbol: z.string().optional(),
  source: z.string().optional(),
  author: z.string().optional(),
  agent: z.string().optional(),
  customMetadataJson: z.string().optional(),
});

type FormState = z.infer<typeof formSchema>;

type MetadataFieldKey =
  | "repo"
  | "repo_name"
  | "language"
  | "frameworks"
  | "tags"
  | "path"
  | "symbol"
  | "source"
  | "author"
  | "agent";

interface MetadataField {
  readonly key: MetadataFieldKey;
  readonly label: string;
}

const metadataFields: readonly MetadataField[] = [
  { key: "repo", label: "Repository" },
  { key: "repo_name", label: "Repo name" },
  { key: "language", label: "Language" },
  { key: "frameworks", label: "Frameworks (csv)" },
  { key: "tags", label: "Tags (csv)" },
  { key: "path", label: "Path" },
  { key: "symbol", label: "Symbol" },
  { key: "source", label: "Source" },
  { key: "author", label: "Author" },
  { key: "agent", label: "Agent" },
] as const;

const initialForm: FormState = {
  content: "",
  type: "decision",
  scope: "repo",
  repo: "",
  repo_name: "",
  language: "",
  frameworks: "",
  tags: "",
  path: "",
  symbol: "",
  source: "",
  author: "",
  agent: "",
  customMetadataJson: "{}",
};

function getInitialFormState(): FormState {
  if (typeof window === "undefined") {
    return initialForm;
  }

  const raw = window.sessionStorage.getItem(draftStorageKey);
  if (!raw) {
    return initialForm;
  }

  try {
    const parsed = JSON.parse(raw) as FormState;
    return { ...initialForm, ...parsed };
  } catch {
    window.sessionStorage.removeItem(draftStorageKey);
    return initialForm;
  }
}

function splitCsv(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Full markdown memory editor with metadata panel, preview, and draft persistence.
 */
export default function NewMemoryPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(getInitialFormState);
  const [previewHtml, setPreviewHtml] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.setItem(draftStorageKey, JSON.stringify(form));
  }, [form]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const file = await unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(rehypeSanitize)
        .use(rehypeStringify)
        .process(form.content || "");

      if (!cancelled) {
        setPreviewHtml(String(file));
      }
    };

    run().catch(() => {
      if (!cancelled) {
        setPreviewHtml("");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [form.content]);

  const metadata = useMemo(() => {
    let custom: Record<string, unknown> = {};
    if (form.customMetadataJson?.trim()) {
      try {
        const parsed = JSON.parse(form.customMetadataJson);
        if (parsed && typeof parsed === "object") {
          custom = parsed as Record<string, unknown>;
        }
      } catch {
        custom = {};
      }
    }

    return {
      repo: form.repo || null,
      repo_name: form.repo_name || null,
      language: form.language || null,
      frameworks: splitCsv(form.frameworks),
      tags: splitCsv(form.tags),
      path: form.path || null,
      symbol: form.symbol || null,
      source: form.source || null,
      author: form.author || null,
      agent: form.agent || null,
      ...custom,
    };
  }, [form]);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = formSchema.safeParse(form);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid form");
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch("/api/memory/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": readCsrfTokenFromMeta(),
        },
        body: JSON.stringify({
          content: parsed.data.content,
          type: parsed.data.type,
          scope: parsed.data.scope,
          metadata,
        }),
      });

      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        data?: Record<string, unknown>;
      };

      if (!response.ok || !payload.success) {
        setError(payload.error ?? "Failed to create memory");
        setSubmitting(false);
        return;
      }

      setSuccess("Memory saved");
      sessionStorage.removeItem(draftStorageKey);
      const createdId = String(
        payload.data?.id ??
          payload.data?.memory_id ??
          payload.data?.memoryId ??
          "",
      );

      if (createdId) {
        router.push(`/memories/${encodeURIComponent(createdId)}`);
      } else {
        router.push("/memories");
      }
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to save memory",
      );
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <h1 className="text-3xl font-extrabold text-gray-900">New Memory</h1>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          <section className="lg:col-span-2 bg-white rounded-lg shadow p-4 space-y-4">
            <p className="text-sm text-gray-600">Markdown editor</p>
            <CodeMirror
              value={form.content}
              extensions={[markdown()]}
              height="320px"
              onChange={(value) =>
                setForm((current) => ({ ...current, content: value }))
              }
            />

            <div className="bg-gray-900 text-gray-100 rounded p-4 min-h-56 overflow-auto">
              <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
            </div>
          </section>

          <section className="bg-white rounded-lg shadow p-4 space-y-3">
            <p className="text-sm font-semibold text-gray-900">Metadata</p>

            <select
              value={form.type}
              onChange={(event) =>
                setForm((current) => ({ ...current, type: event.target.value }))
              }
              className="w-full border rounded px-3 py-2"
            >
              <option value="decision">decision</option>
              <option value="fix">fix</option>
              <option value="convention">convention</option>
              <option value="gotcha">gotcha</option>
              <option value="tradeoff">tradeoff</option>
              <option value="pattern">pattern</option>
              <option value="reference">reference</option>
            </select>

            <select
              value={form.scope}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  scope: event.target.value,
                }))
              }
              className="w-full border rounded px-3 py-2"
            >
              <option value="repo">repo</option>
              <option value="project">project</option>
              <option value="global">global</option>
            </select>

            {metadataFields.map(({ key, label }) => (
              <input
                key={key}
                value={String(form[key] ?? "")}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                className="w-full border rounded px-3 py-2"
                placeholder={label}
              />
            ))}

            <textarea
              value={form.customMetadataJson}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  customMetadataJson: event.target.value,
                }))
              }
              className="w-full border rounded px-3 py-2 min-h-28"
              placeholder="Custom metadata JSON"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save memory"}
            </button>

            {error ? <p className="text-sm text-red-700">{error}</p> : null}
            {success ? (
              <p className="text-sm text-green-700">{success}</p>
            ) : null}
          </section>
        </form>
      </div>
    </main>
  );
}
