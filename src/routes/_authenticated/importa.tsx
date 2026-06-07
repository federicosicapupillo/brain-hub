import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/importa")({
  component: ImportaLayout,
  errorComponent: ({ error }) => (
    <div className="p-6" role="alert">Errore: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-6">Pagina non trovata.</div>,
});

function ImportaLayout() {
  return <Outlet />;
}