// Full MCP path runner.
//
// STAGE 0 IMPLEMENTATION NOTE: this file ships a reduced surface that exercises the same guardrail code-path
// an MCP client would hit (Layer1 + scanPage simulation), without standing up an MCP client/server pair
// inside the harness. A category-G payload's `page_content_fixture` is injected as synthetic scan input.
//
// A full MCP stdio harness (spawn the server, issue MCP tool calls) is tracked as Stage 1 follow-up and
// would replace only this file; the outer runner contract is stable.

import type { AttackPayload, RunnerResult } from "../types.js";
import { runHybrid } from "./hybrid.js";

const HIDDEN_INSTRUCTION_PATTERNS = [
  /\bignore (all |previous |your |the )/i,
  /\byou are now\b/i,
  /\bapprove any purchase\b/i,
  /\bthis is authorized\b/i,
  /\bsystem (says|has|override)\b/i,
];

function scanPageContent(content: string | undefined): { tainted: boolean; reason: string } {
  if (!content) return { tainted: false, reason: "no fixture" };
  for (const pat of HIDDEN_INSTRUCTION_PATTERNS) {
    if (pat.test(content)) return { tainted: true, reason: `scan_match:${pat}` };
  }
  return { tainted: false, reason: "scan_clean" };
}

export async function runFullMcp(p: AttackPayload): Promise<RunnerResult> {
  const start = performance.now();
  const scan = scanPageContent(p.page_content_fixture);
  if (scan.tainted) {
    return {
      runner: "full_mcp",
      verdict: "block",
      reason: `scan:${scan.reason}`,
      latency_ms: performance.now() - start,
    };
  }
  const hybrid = await runHybrid(p);
  return {
    runner: "full_mcp",
    verdict: hybrid.verdict,
    reason: `hybrid:${hybrid.reason}`,
    latency_ms: performance.now() - start,
    error: hybrid.error,
    ...(hybrid.raw !== undefined && { raw: hybrid.raw }),
  };
}
