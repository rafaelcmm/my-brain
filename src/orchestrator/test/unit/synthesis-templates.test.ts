import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../../src/application/synthesis/templates.js";
import type { SynthesisToolName } from "../../src/domain/synthesis.js";

interface TemplateCase {
  tool: SynthesisToolName;
  expectedInstruction: string;
  data: Record<string, unknown>;
  expectedDataField: string;
}

const CASES: TemplateCase[] = [
  {
    tool: "mb_capabilities",
    expectedInstruction: "runtime capability state",
    data: {
      capabilities: { engine: true, vectorDb: true, embeddingDim: 1024 },
    },
    expectedDataField: "capabilities",
  },
  {
    tool: "mb_context_probe",
    expectedInstruction: "derived project context",
    data: { repo: "org/repo", language: "typescript", frameworks: ["nextjs"] },
    expectedDataField: "repo",
  },
  {
    tool: "mb_remember",
    expectedInstruction: "whether it deduplicated",
    data: { memory_id: "m1", type: "decision", deduped: false },
    expectedDataField: "memory_id",
  },
  {
    tool: "mb_recall",
    expectedInstruction: "using only the provided memory snippets",
    data: { query: "q", results: [{ id: "m1", content: "fact" }] },
    expectedDataField: "results",
  },
  {
    tool: "mb_vote",
    expectedInstruction: "vote changed",
    data: { memory_id: "m1", direction: "up", vote_bias: 0.2 },
    expectedDataField: "direction",
  },
  {
    tool: "mb_forget",
    expectedInstruction: "soft or hard forget",
    data: { memory_id: "m1", mode: "soft" },
    expectedDataField: "mode",
  },
  {
    tool: "mb_session_open",
    expectedInstruction: "new tracked session",
    data: { session_id: "s1", agent: "main", route_confidence: 0.5 },
    expectedDataField: "session_id",
  },
  {
    tool: "mb_session_close",
    expectedInstruction: "closed session",
    data: { session_id: "s1", success: true, quality: 0.9 },
    expectedDataField: "quality",
  },
  {
    tool: "mb_digest",
    expectedInstruction: "aggregate counts",
    data: {
      rows: [{ type: "decision", count: 3 }],
      learning: { sessions_opened: 2 },
    },
    expectedDataField: "rows",
  },
];

for (const c of CASES) {
  test(`buildPrompt includes instruction and data for ${c.tool}`, () => {
    const prompt = buildPrompt(c.tool, "What changed?", c.data);

    assert.match(prompt, /Output plain text\./);
    assert.match(prompt, /untrusted user memory/);
    assert.match(prompt, /<<<DATA>>>/);
    assert.match(prompt, /<<<END>>>/);
    assert.match(prompt, new RegExp(c.expectedInstruction, "u"));
    assert.ok(prompt.includes(`\"${c.expectedDataField}\"`));
    assert.match(prompt, /Question: What changed\?/);
  });
}

test("buildPrompt strips line breaks from question and data snippets", () => {
  const prompt = buildPrompt("mb_recall", "Line one\nline two", {
    results: [{ id: "m1", content: "a\n\nb" }],
  });

  assert.ok(!prompt.includes("Line one\nline two"));
  assert.match(prompt, /Question: Line one line two/);
  assert.match(prompt, /"content":"a b"/);
});
