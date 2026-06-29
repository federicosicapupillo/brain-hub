import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { GmailAutoSyncProvider } from "@/context/gmail-auto-sync-context";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  // v3.25.6 — wrap the authenticated subtree with the Global Gmail Auto
  // Sync Provider so the 5-minute scheduler runs across every page, not
  // just Gmail Connector. The auth gate above is preserved verbatim.
  component: () => (
    <GmailAutoSyncProvider brainId={null}>
      <Outlet />
    </GmailAutoSyncProvider>
  ),
});
