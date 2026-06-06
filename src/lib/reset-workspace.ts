import { supabase } from "@/integrations/supabase/client";

export interface ResetSummary {
  tables: Record<string, number>;
  storageFiles: number;
}

const TABLES = [
  "live_events",
  "app_logs",
  "tasks",
  "roadmap_items",
  "agents",
  "import_jobs",
  "knowledge_chunks",
  "knowledge_sources",
  "brain_edges",
  "brain_nodes",
  "brains",
  "connectors",
] as const;

export async function resetCurrentUserWorkspace(): Promise<ResetSummary> {
  const { data: userData, error: ue } = await supabase.auth.getUser();
  if (ue || !userData.user) throw ue ?? new Error("Non autenticato");
  const uid = userData.user.id;

  const summary: ResetSummary = { tables: {}, storageFiles: 0 };

  for (const t of TABLES) {
    const { count: before } = await supabase
      .from(t)
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid);
    const { error } = await supabase.from(t).delete().eq("user_id", uid);
    if (error) throw new Error(`${t}: ${error.message}`);
    summary.tables[t] = before ?? 0;
  }

  // Storage cleanup: list files under user prefix and remove
  try {
    const prefix = uid;
    const { data: files } = await supabase.storage
      .from("brain-uploads")
      .list(prefix, { limit: 1000 });
    if (files && files.length > 0) {
      const paths = files.map((f) => `${prefix}/${f.name}`);
      const { error: se } = await supabase.storage.from("brain-uploads").remove(paths);
      if (!se) summary.storageFiles = paths.length;
    }
  } catch (e) {
    console.warn("[reset] storage cleanup skipped", e);
  }

  return summary;
}
