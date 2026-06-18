// ============================================================
// Brain Hub v3.10.2 — Project Alias Resolution for Jack
// ============================================================
// READ-ONLY. Used by jack-command-router to map free-form voice
// mentions ("Furia", "Sica", "Brain Hub") to real brain rows.
// ============================================================

export type BrainRef = { id: string; name: string };

export type ProjectMatch = {
  brain: BrainRef;
  matched_token: string;
  score: number; // higher = better
  via: "exact_name" | "name_contains" | "alias";
};

export type ProjectResolution =
  | { kind: "resolved"; brain: BrainRef; match: ProjectMatch }
  | { kind: "ambiguous"; candidates: ProjectMatch[] }
  | { kind: "none" };

// Heuristic alias rules used as fallback when DB names don't match.
// Each entry maps lowercase alias tokens to a target name fragment.
export type AliasRule = {
  alias: string;
  target_name_fragment: string; // matched against brain.name (normalized substring)
  note?: string;
};

const ALIAS_RULES: AliasRule[] = [
  // Brain Hub
  { alias: "brain hub", target_name_fragment: "brain hub" },
  { alias: "brainhub", target_name_fragment: "brain hub" },
  { alias: "brian hub", target_name_fragment: "brain hub", note: "typo comune" },
  { alias: "brianhub", target_name_fragment: "brain hub", note: "typo comune" },
  { alias: "braian hub", target_name_fragment: "brain hub", note: "typo comune" },
  // Furia
  { alias: "furia", target_name_fragment: "furia" },
  { alias: "furia immobiliare", target_name_fragment: "furia immobiliare" },
  // Sica
  { alias: "sica immobiliare", target_name_fragment: "sica immobiliare" },
  { alias: "sica industrial radar", target_name_fragment: "sica industrial radar" },
  { alias: "industrial radar", target_name_fragment: "industrial radar" },
  { alias: "capannoni", target_name_fragment: "industrial radar" },
  { alias: "capannone", target_name_fragment: "industrial radar" },
  // NB: "sica" da solo è ambiguo (più brain "Sica *"): risolto come ambiguity dal lookup name_contains
  // Pupillo / Studio Nikla / IdeaPilot
  { alias: "pupillo", target_name_fragment: "pupillo" },
  { alias: "studio nikla", target_name_fragment: "nikla" },
  { alias: "nikla", target_name_fragment: "nikla" },
  { alias: "idea pilot", target_name_fragment: "ideapilot" },
  { alias: "ideapilot", target_name_fragment: "ideapilot" },
];

export function listProjectAliasRules(): AliasRule[] {
  return [...ALIAS_RULES];
}

export function normalizeProjectName(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.,;:'"()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Extracts the substring after common project connectors
// ("su", "con", "di", "per", "del", "della") up to end / punctuation.
// Returns null if no mention pattern is found.
export function extractProjectMention(transcript: string): string | null {
  const norm = normalizeProjectName(transcript);
  if (!norm) return null;
  const re = /\b(?:con|su|di|del|della|per|sul|sulla|sui|sugli)\s+([a-z0-9 ]{2,60})$/i;
  const m = norm.match(re);
  if (m && m[1]) return m[1].trim();
  // fallback: detect last "alias" token directly
  for (const rule of ALIAS_RULES) {
    if (norm.includes(rule.alias)) return rule.alias;
  }
  return null;
}

// Resolves a free-form mention against the loaded brains list.
// Strategy:
//  1) exact normalized name match
//  2) brain name contains mention (or vice versa) — collect candidates
//  3) alias rule -> target_name_fragment -> brain name contains
// Multiple candidates => ambiguous. None => "none".
export function resolveProjectAlias(
  rawMention: string,
  brains: BrainRef[],
): ProjectResolution {
  const mention = normalizeProjectName(rawMention);
  if (!mention) return { kind: "none" };
  const candidates: ProjectMatch[] = [];
  const seen = new Set<string>();

  const push = (m: ProjectMatch) => {
    if (seen.has(m.brain.id)) return;
    seen.add(m.brain.id);
    candidates.push(m);
  };

  // 1) exact
  for (const b of brains) {
    if (normalizeProjectName(b.name) === mention) {
      push({ brain: b, matched_token: mention, score: 100, via: "exact_name" });
    }
  }
  if (candidates.length === 1) {
    return { kind: "resolved", brain: candidates[0].brain, match: candidates[0] };
  }

  // 2) name contains / mention contains name
  for (const b of brains) {
    const n = normalizeProjectName(b.name);
    if (seen.has(b.id)) continue;
    if (n.includes(mention) || mention.includes(n)) {
      const score = Math.min(n.length, mention.length);
      push({ brain: b, matched_token: mention, score: 50 + score, via: "name_contains" });
    }
  }

  // 3) alias rules
  for (const rule of ALIAS_RULES) {
    if (!mention.includes(rule.alias)) continue;
    for (const b of brains) {
      const n = normalizeProjectName(b.name);
      if (seen.has(b.id)) continue;
      if (n.includes(rule.target_name_fragment)) {
        push({
          brain: b,
          matched_token: rule.alias,
          score: 40 + rule.alias.length,
          via: "alias",
        });
      }
    }
  }

  if (candidates.length === 0) return { kind: "none" };
  candidates.sort((a, b) => b.score - a.score);
  // If the top score is clearly better than the runner-up, pick it.
  if (candidates.length === 1 || candidates[0].score - candidates[1].score >= 20) {
    return { kind: "resolved", brain: candidates[0].brain, match: candidates[0] };
  }
  return { kind: "ambiguous", candidates: candidates.slice(0, 4) };
}
