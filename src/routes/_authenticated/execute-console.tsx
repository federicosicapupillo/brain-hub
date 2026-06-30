import { createFileRoute } from "@tanstack/react-router";
import { ExecuteConsoleDashboard } from "@/components/os/ExecuteConsoleDashboard";

export const Route = createFileRoute("/_authenticated/execute-console")({
  head: () => ({
    meta: [{ title: "Execute Console — Brain Hub OS" }],
  }),
  component: ExecuteConsoleDashboard,
});
