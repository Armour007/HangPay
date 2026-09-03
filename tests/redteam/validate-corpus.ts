// Corpus validator + deduper. Runs as standalone script and is called by the harness boot.
// Usage: npx tsx tests/redteam/validate-corpus.ts [path/to/attacks.json]

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { AttackPayload, Category } from "./types.js";

const CATEGORIES: Category[] = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    total: number;
    per_category: Record<Category, number>;
    per_expected: { block: number; approve: number };
    duplicates_removed: number;
  };
  corpus_hash: string;
}

function payloadFingerprint(p: AttackPayload): string {
  // Collision-resistant identity: category + vendor + amount + reasoning + page_url + allowed_categories.
  // id is excluded so a dedup pass can catch two payloads with different ids but identical semantics.
  return createHash("sha256")
    .update(
      JSON.stringify({
        category: p.category,
        vendor: p.vendor,
        amount: p.amount,
        reasoning: p.reasoning,
        page_url: p.page_url,
        allowed_categories: [...p.allowed_categories].sort(),
      }),
    )
    .digest("hex");
}

export function validateCorpus(payloads: unknown): { report: ValidationReport; deduped: AttackPayload[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Array.isArray(payloads)) {
    return {
      report: {
        ok: false,
        errors: ["Corpus must be a JSON array"],
        warnings: [],
        stats: { total: 0, per_category: {} as Record<Category, number>, per_expected: { block: 0, approve: 0 }, duplicates_removed: 0 },
        corpus_hash: "",
      },
      deduped: [],
    };
  }

  const seen = new Map<string, string>(); // fingerprint -> first id
  const idSet = new Set<string>();
  const deduped: AttackPayload[] = [];
  const per_category: Record<string, number> = {};
  const per_expected = { block: 0, approve: 0 };
  let dupes = 0;

  for (let i = 0; i < payloads.length; i++) {
    const p = payloads[i] as AttackPayload;
    const ctx = `payload[${i}] (id=${p?.id ?? "?"})`;

    if (!p || typeof p !== "object") {
      errors.push(`${ctx}: not an object`);
      continue;
    }
    if (!p.id || !/^[A-K]-\d{4}$/.test(p.id)) errors.push(`${ctx}: id must match [A-K]-NNNN`);
    if (!CATEGORIES.includes(p.category as Category)) errors.push(`${ctx}: invalid category ${p.category}`);
    // Schema constraints are enforced strictly only for benign payloads (expected=approve).
    // Adversarial payloads may deliberately violate these (empty/overlong vendor, zero/negative amount) —
    // that is the attack surface under test. Still require correct types.
    if (typeof p.vendor !== "string") errors.push(`${ctx}: vendor must be string`);
    else if (p.expected === "approve" && (!p.vendor || p.vendor.length > 200)) errors.push(`${ctx}: benign vendor missing or >200 chars`);
    else if (p.vendor.length > 4000) errors.push(`${ctx}: vendor >4000 chars (runaway)`);
    if (typeof p.amount !== "number" || Number.isNaN(p.amount)) errors.push(`${ctx}: amount must be number`);
    else if (p.expected === "approve" && p.amount <= 0) errors.push(`${ctx}: benign amount must be positive`);
    if (typeof p.reasoning !== "string") errors.push(`${ctx}: reasoning must be string`);
    else if (p.reasoning.length > 4000) errors.push(`${ctx}: reasoning >4000 chars (runaway)`);
    if (!Array.isArray(p.allowed_categories)) errors.push(`${ctx}: allowed_categories must be array`);
    if (p.expected !== "block" && p.expected !== "approve") errors.push(`${ctx}: expected must be block|approve`);
    if (!Array.isArray(p.variant_tags)) errors.push(`${ctx}: variant_tags must be array`);

    if (p.id && idSet.has(p.id)) errors.push(`${ctx}: duplicate id`);
    if (p.id) idSet.add(p.id);

    const fp = payloadFingerprint(p);
    if (seen.has(fp)) {
      dupes++;
      warnings.push(`${ctx}: semantic duplicate of ${seen.get(fp)}`);
      continue;
    }
    seen.set(fp, p.id);
    deduped.push(p);

    per_category[p.category] = (per_category[p.category] ?? 0) + 1;
    if (p.expected === "block") per_expected.block++;
    else per_expected.approve++;
  }

  // Coverage sanity — warn if any category has <5 variants (methodology §3.2)
  for (const cat of CATEGORIES) {
    const n = per_category[cat] ?? 0;
    if (n < 5) warnings.push(`Category ${cat} has only ${n} payloads (methodology target ≥5 variants)`);
  }

  // Honest metrics — Category B must have benign counterparts (criteria doc §4, 1:3 ratio → ≥25% benign)
  const bAttack = deduped.filter((p) => p.category === "B" && p.expected === "block").length;
  const bBenign = deduped.filter((p) => p.category === "B" && p.expected === "approve").length;
  if (bAttack > 0 && bBenign < Math.max(25, Math.floor(bAttack / 3))) {
    warnings.push(`Category B benign count ${bBenign} below false-reject floor (need max(25, attacks/3))`);
  }

  const corpus_hash = createHash("sha256").update(JSON.stringify(deduped.map((p) => p.id).sort())).digest("hex");

  return {
    report: {
      ok: errors.length === 0,
      errors,
      warnings,
      stats: {
        total: deduped.length,
        per_category: per_category as Record<Category, number>,
        per_expected,
        duplicates_removed: dupes,
      },
      corpus_hash,
    },
    deduped,
  };
}

export function loadCorpus(path: string): AttackPayload[] {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const { report, deduped } = validateCorpus(raw);
  if (!report.ok) {
    throw new Error(`Corpus validation failed:\n${report.errors.join("\n")}`);
  }
  if (report.warnings.length) {
    for (const w of report.warnings) console.warn(`[corpus-warning] ${w}`);
  }
  return deduped;
}

// CLI entry
const invokedAsCli = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("validate-corpus.ts");
  } catch {
    return typeof process.argv[1] === "string" && process.argv[1].endsWith("validate-corpus.ts");
  }
})();

if (invokedAsCli) {
  const path = process.argv[2] ?? "tests/redteam/corpus/attacks.json";
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const { report } = validateCorpus(raw);
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
