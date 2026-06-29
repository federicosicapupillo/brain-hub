import { createFileRoute } from "@tanstack/react-router";
import { OsModuleDashboard } from "@/components/os/OsModuleDashboard";

export const Route = createFileRoute("/_authenticated/os/governance")({
  component: () => <OsModuleDashboard moduleId="governance" />,
});
