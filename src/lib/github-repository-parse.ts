// Brain Hub v3.16.1 — GitHub Repository input parser & normalizer.
// Puro: nessuna API GitHub live, nessun fetch, nessun side effect.

export type GithubRepositoryParseErrorCode =
  | "empty_input"
  | "not_a_github_url"
  | "missing_owner_or_repo"
  | "invalid_owner_or_repo";

export type GithubRepositoryParseResult =
  | {
      isValid: true;
      url: string;
      owner: string;
      name: string;
      normalizedUrl: string;
      errorCode: null;
    }
  | {
      isValid: false;
      url: null;
      owner: null;
      name: null;
      normalizedUrl: null;
      errorCode: GithubRepositoryParseErrorCode;
    };

const SEGMENT_RE = /^[A-Za-z0-9._-]+$/;
// Match http(s)://github.com/owner/repo with optional .git, trailing slash,
// or extra path segments (issues, pull, tree, blob…). We normalize to root.
const URL_RE =
  /https?:\/\/github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/#?\s]|$)/i;

export function parseGithubRepositoryInput(
  input: string | null | undefined,
): GithubRepositoryParseResult {
  const invalid = (
    code: GithubRepositoryParseErrorCode,
  ): GithubRepositoryParseResult => ({
    isValid: false,
    url: null,
    owner: null,
    name: null,
    normalizedUrl: null,
    errorCode: code,
  });

  if (!input || typeof input !== "string") return invalid("empty_input");
  const trimmed = input.trim();
  if (!trimmed) return invalid("empty_input");

  const m = trimmed.match(URL_RE);
  if (!m) return invalid("not_a_github_url");

  const owner = m[1];
  const name = m[2];
  if (!owner || !name) return invalid("missing_owner_or_repo");
  if (!SEGMENT_RE.test(owner) || !SEGMENT_RE.test(name)) {
    return invalid("invalid_owner_or_repo");
  }

  const url = `https://github.com/${owner}/${name}`;
  return {
    isValid: true,
    url,
    owner,
    name,
    normalizedUrl: url.toLowerCase(),
    errorCode: null,
  };
}

export function isSuspectRepositoryRecord(repo: {
  repository_url: string | null;
  repository_owner: string | null;
  repository_name: string | null;
}): boolean {
  const url = repo.repository_url ?? "";
  const owner = repo.repository_owner ?? "";
  const name = repo.repository_name ?? "";
  if (!owner.trim() || !name.trim()) return true;
  if (/\s/.test(owner) || /\s/.test(name)) return true;
  if (/[\r\n]/.test(url)) return true;
  if (!url.startsWith("https://github.com/")) return true;
  const parsed = parseGithubRepositoryInput(url);
  if (!parsed.isValid) return true;
  // url already normalized?
  if (parsed.url !== url) return true;
  if (parsed.owner !== owner || parsed.name !== name) return true;
  return false;
}

export function repositoryInputErrorMessage(
  code: GithubRepositoryParseErrorCode,
): string {
  switch (code) {
    case "empty_input":
      return "URL repository obbligatorio";
    case "not_a_github_url":
      return "URL GitHub non valido. Usa il formato https://github.com/owner/repo";
    case "missing_owner_or_repo":
      return "Owner e repository name sono obbligatori";
    case "invalid_owner_or_repo":
      return "Owner o repository name contengono caratteri non validi";
  }
}
