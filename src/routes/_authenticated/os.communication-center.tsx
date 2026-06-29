import { createFileRoute } from "@tanstack/react-router";
import { OsModuleDashboard } from "@/components/os/OsModuleDashboard";

export const Route = createFileRoute("/_authenticated/os/communication-center")({
  component: () => <OsModuleDashboard moduleId="communication-center" />,
});
