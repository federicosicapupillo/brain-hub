import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient-primary">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Questo neurone non esiste.</p>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Qualcosa è andato storto</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <button onClick={reset} className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">
          Riprova
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Personal AI Brain Dashboard" },
      { name: "description", content: "Il tuo second brain personale: cervelli, agenti, task e conoscenza in un'unica dashboard AI." },
      { property: "og:title", content: "Personal AI Brain Dashboard" },
      { name: "twitter:title", content: "Personal AI Brain Dashboard" },
      { property: "og:description", content: "Il tuo second brain personale: cervelli, agenti, task e conoscenza in un'unica dashboard AI." },
      { name: "twitter:description", content: "Il tuo second brain personale: cervelli, agenti, task e conoscenza in un'unica dashboard AI." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a6a99b67-e143-4a68-aa0b-c66c5152b0d8/id-preview-60c8e4ca--1680bc9b-5bc8-47f2-9477-f4fa60593f9c.lovable.app-1781701667397.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a6a99b67-e143-4a68-aa0b-c66c5152b0d8/id-preview-60c8e4ca--1680bc9b-5bc8-47f2-9477-f4fa60593f9c.lovable.app-1781701667397.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="it" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAuthPage = pathname === "/auth";

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        router.invalidate();
        if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
  }

  if (isAuthPage) {
    return (
      <QueryClientProvider client={queryClient}>
        <Outlet />
        <Toaster richColors theme="dark" />
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-border/60 bg-background/60 px-3 backdrop-blur">
              <SidebarTrigger />
              <div className="ml-1 text-xs text-muted-foreground">Personal AI Brain</div>
              <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex h-2 w-2 animate-pulse-glow rounded-full bg-emerald-400 text-emerald-400" />
                Live · sync attivo
                <Button variant="ghost" size="sm" onClick={handleSignOut} className="ml-2 h-7 px-2">
                  <LogOut className="h-3.5 w-3.5" />
                </Button>
              </div>
            </header>
            <main className="min-w-0 flex-1">
              <Outlet />
            </main>
          </div>
        </div>
        <Toaster richColors theme="dark" />
      </SidebarProvider>
    </QueryClientProvider>
  );
}
