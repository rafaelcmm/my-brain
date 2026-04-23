import type { Memory, MemoryMetadata, MemoryScope, MemoryType } from "@/lib/domain";
import type { MemoryListItemDto } from "@/lib/infrastructure/orchestrator/dtos/orchestrator-response.dto";

const allowedTypes: MemoryType[] = [
  "decision",
  "fix",
  "convention",
  "gotcha",
  "tradeoff",
  "pattern",
  "reference",
];

const allowedScopes: MemoryScope[] = ["repo", "project", "global"];

/**
 * Normalize transport-level memory item into domain-level Memory aggregate.
 *
 * Why normalize: API may omit metadata fields in list endpoint; domain model
 * requires stable shape so UI rendering remains deterministic.
 */
export function mapMemoryDtoToDomain(dto: MemoryListItemDto): Memory {
  return {
    id: dto.id as Memory["id"],
    content: dto.content,
    type: normalizeType(dto.type),
    scope: normalizeScope(dto.scope),
    metadata: normalizeMetadata(dto),
    created_at: dto.created_at,
    updated_at: dto.updated_at ?? dto.last_seen_at ?? dto.created_at,
  };
}

function normalizeType(value: string): MemoryType {
  return (allowedTypes as string[]).includes(value) ? (value as MemoryType) : "reference";
}

function normalizeScope(value: string): MemoryScope {
  return (allowedScopes as string[]).includes(value) ? (value as MemoryScope) : "repo";
}

function normalizeMetadata(dto: MemoryListItemDto): MemoryMetadata {
  const raw = dto.metadata ?? {};

  const frameworks = Array.isArray(raw.frameworks)
    ? raw.frameworks.filter((entry): entry is string => typeof entry === "string")
    : [];
  const tagsFromRaw = Array.isArray(raw.tags)
    ? raw.tags.filter((entry): entry is string => typeof entry === "string")
    : [];

  const metadata: MemoryMetadata = {
    repo: getNullableString(raw.repo),
    repo_name: dto.repo_name ?? getNullableString(raw.repo_name),
    project: getNullableString(raw.project),
    language: dto.language ?? getNullableString(raw.language),
    frameworks,
    path: getNullableString(raw.path),
    symbol: getNullableString(raw.symbol),
    tags: dto.tags ?? tagsFromRaw,
    source: getNullableString(raw.source),
    author: getNullableString(raw.author),
    agent: getNullableString(raw.agent),
    created_at: getNullableString(raw.created_at),
    expires_at: getNullableString(raw.expires_at),
    confidence: getNullableNumber(raw.confidence),
    visibility: getVisibility(raw.visibility),
  };

  return {
    ...metadata,
    ...raw,
  };
}

function getNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function getNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function getVisibility(value: unknown): MemoryMetadata["visibility"] {
  return value === "team" || value === "public" ? value : "private";
}
