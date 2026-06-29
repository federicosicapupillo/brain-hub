import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/os/")({
  beforeLoad: () => {
    throw redirect({ to: "/os/command-center" });
  },
});
