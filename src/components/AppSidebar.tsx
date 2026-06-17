import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Plug,
  PlugZap,
  Brain,
  Map as MapIcon,
  CheckSquare,
  Bot,
  ScrollText,
  Settings,
  Sparkles,
  Library,
  FolderKanban,
  Inbox,
  Archive,
  ListChecks,
  BookOpen,
  GitBranch,
  ShieldCheck,
  Stethoscope,
  Clipboard,
  Gauge,
  RefreshCw,
  LayoutDashboard,
  BookMarked,
  Send,
  Building2,
  Cpu,
  Home,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

const items = [
  { title: "Home Azienda", url: "/company-home", icon: Home },
  { title: "Company OS", url: "/company-os", icon: Building2 },
  { title: "Company Blueprint", url: "/company-blueprint", icon: BookMarked },
  { title: "Build Engines", url: "/build-engines", icon: Cpu },
  { title: "MVP Factory", url: "/mvp-factory", icon: Sparkles },
  { title: "Live", url: "/live", icon: Activity },
  { title: "Connettori", url: "/connettori", icon: Plug },
  { title: "Strumenti Progetti", url: "/strumenti-progetti", icon: PlugZap },
  { title: "GitHub Sync", url: "/github-sync", icon: GitBranch },
  { title: "GitHub Coverage", url: "/github-coverage", icon: ShieldCheck },
  { title: "Health Check", url: "/health-check", icon: Stethoscope },
  { title: "Clipboard AI", url: "/clipboard-ai", icon: Clipboard },
  { title: "Automation Control", url: "/automation-control", icon: Gauge },
  { title: "Action Queue", url: "/action-queue", icon: Gauge },
  { title: "Automation Readiness", url: "/automation-readiness", icon: ShieldCheck },
  { title: "n8n Workflows", url: "/n8n-workflows", icon: GitBranch },
  { title: "Project Loop", url: "/project-loop", icon: RefreshCw },
  { title: "Operating Dashboard", url: "/operating-dashboard", icon: LayoutDashboard },
  { title: "Project Console", url: "/project-console", icon: LayoutDashboard },
  { title: "Tool Connections", url: "/tool-connections", icon: Plug },
  { title: "Runbooks", url: "/runbooks", icon: BookMarked },
  { title: "Telegram Approvals", url: "/telegram-approvals", icon: Send },
  { title: "Result Review", url: "/result-review", icon: CheckSquare },
  { title: "Loop QA", url: "/loop-qa", icon: GitBranch },
  { title: "Knowledge Map", url: "/knowledge-map", icon: BookOpen },
  { title: "Cervelli", url: "/", icon: Brain },
  { title: "Progetti", url: "/progetti", icon: FolderKanban },
  { title: "Prossime Azioni", url: "/prossime-azioni", icon: ListChecks },
  { title: "Allineamento", url: "/allineamento", icon: GitBranch },
  { title: "Importa", url: "/importa", icon: Inbox },
  { title: "Archivio", url: "/archivio", icon: Archive },
  { title: "Fonti", url: "/fonti", icon: Library },
  { title: "Roadmap", url: "/roadmap", icon: MapIcon },
  { title: "Tasks", url: "/tasks", icon: CheckSquare },
  { title: "Agents", url: "/agents", icon: Bot },
  { title: "Logs", url: "/logs", icon: ScrollText },
  { title: "Guida", url: "/guida", icon: BookOpen },
  { title: "Impostazioni", url: "/impostazioni", icon: Settings },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  const isActive = (url: string) => (url === "/" ? pathname === "/" : pathname.startsWith(url));

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link to="/" className="flex items-center gap-2 px-2 py-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-primary glow-violet">
            <Sparkles className="h-5 w-5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm font-semibold text-gradient-primary">AI Brain</div>
              <div className="text-[11px] text-muted-foreground">Personal Dashboard</div>
            </div>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                    <Link to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
