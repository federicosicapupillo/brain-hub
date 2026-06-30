import { createFileRoute } from "@tanstack/react-router";
import { CommandCenterV2Dashboard } from "@/components/os/CommandCenterV2Dashboard";

export const Route = createFileRoute("/_authenticated/os/command-center-v2")({
  component: CommandCenterV2Dashboard,
});
