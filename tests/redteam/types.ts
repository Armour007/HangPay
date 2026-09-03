// Shared types for the RT-1 red team harness.

export type Category = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K";
export type ExpectedVerdict = "block" | "approve";
export type LayerTarget = "layer1" | "layer2" | "hybrid" | "full_mcp" | "toctou" | "any";

export interface AttackPayload {
  id: string;
  category: Category;
  layer_target: LayerTarget;
  vendor: string;
  amount: number;
  reasoning: string;
  page_url: string | null;
  allowed_categories: string[];
  expected: ExpectedVerdict;
  variant_tags: string[];
  page_content_fixture?: string;
  rationale?: string;
}

export type Verdict = "approve" | "block" | "error" | "skip";

export interface RunnerResult {
  runner: "layer1" | "layer2" | "hybrid" | "full_mcp" | "toctou" | "scan";
  verdict: Verdict;
  reason: string;
  latency_ms: number;
  error?: string;
  raw?: unknown;
}

export interface PayloadRunRow {
  payload_id: string;
  category: Category;
  expected: ExpectedVerdict;
  run_index: number;
  layer1?: RunnerResult;
  layer2?: RunnerResult;
  hybrid?: RunnerResult;
  full_mcp?: RunnerResult;
  toctou?: RunnerResult;
  scan?: RunnerResult;
  attribution: string[];
}

export interface CorpusHashHeader {
  corpus_hash: string;
  corpus_size: number;
  generated_at: string;
  git_sha: string | null;
  model: string | null;
  n_runs_per_payload: number;
  sample_size?: number;
  sample_seed?: number;
  sample_category_breakdown?: Record<string, number>;
}
