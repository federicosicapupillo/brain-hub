// Brain Hub v3.28 — OS layout route. Lives under _authenticated, separate
// from the existing global navigation. Provides a dedicated left sidebar
// listing the 9 OS modules with status badges derived from the audit.

import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  FolderKanban,
  Send,
  BookOpen,
  GitBranch,
  Play,
  Bot,
  Brain,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { OsStatusBadge, useOsModuleMap } from "@/components/os/OsModuleDashboard";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  FolderKanban,
  Send,
  BookOpen,
  GitBranch,
  Play,
  Bot,
  Brain,
  ShieldCheck,
};

export const Route = createFileRoute("/_authenticated/os")({
  head: () => ({ meta: [{ title: "Brain Hub OS" }] }),
  component: OsLayout,
});

function OsLayout() {
  const q = useOsModuleMap();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const modules = q.data?.modules ?? [];
  const activeMod = modules.find((m) => pathname.startsWith(m.route));

  return (
    <div className="flex min-h-[calc(100vh-3rem)] w-full">
      <aside className="w-64 shrink-0 border-r border-border/60 bg-card/40">
        <div className="border-b border-border/60 p-4">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Brain Hub
          </p>
          <h2 className="text-lg font-semibold">OS</h2>
        </div>
        <nav className="space-y-0.5 p-2">
          {q.isLoading ? (
            <p className="p-2 text-xs text-muted-foreground">Loading…</p>
          ) : q.isError ? (
            <p className="p-2 text-xs text-rose-600">Module map unavailable.</p>
          ) : (
            modules.map((m) => {
              const Icon = ICONS[m.icon] ?? LayoutDashboard;
              const isActive = pathname.startsWith(m.route);
              return (
                <Link
                  key={m.id}
                  to={m.route}
                  className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    isActive
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/60 text-muted-foreground"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{m.name}</span>
                  </span>
                  <OsStatusBadge status={m.status} />
                </Link>
              );
            })
          )}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-12 items-center border-b border-border/60 px-4 text-sm">
          <span className="text-muted-foreground">OS</span>
          {activeMod ? (
            <>
              <span className="mx-2 text-muted-foreground">/</span>
              <span className="font-medium">{activeMod.name}</span>
            </>
          ) : null}
        </header>
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
