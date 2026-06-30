import { createFileRoute } from "@tanstack/react-router";
import { CommandCenterDashboard } from "@/components/os/CommandCenterDashboard";

export const Route = createFileRoute("/_authenticated/os/command-center")({
  component: CommandCenterDashboard,
});
