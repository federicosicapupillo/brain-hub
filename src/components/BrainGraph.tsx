import { useEffect, useMemo, useRef, useState } from "react";
import type { BrainNode, BrainEdge, Brain } from "@/lib/demo-data";

interface Props {
  nodes: BrainNode[];
  edges: BrainEdge[];
  brains: Brain[];
  selectedId?: string;
  onSelect: (id: string | undefined) => void;
  mode: "2d" | "3d";
}

const TYPE_COLORS: Record<string, string> = {
  nota: "var(--neon-cyan)",
  documento: "var(--neon-violet)",
  progetto: "var(--neon-pink)",
  task: "var(--neon-amber)",
  agente: "var(--neon-emerald)",
  prompt: "var(--neon-amber)",
  roadmap: "var(--neon-pink)",
  fonte: "var(--neon-cyan)",
};

export function BrainGraph({ nodes, edges, brains, selectedId, onSelect, mode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; z: number }>();
    for (const n of nodes) {
      // light 3D effect: parallax based on hashed depth
      const z = mode === "3d" ? ((n.id.length * 53) % 100) / 100 : 0.5;
      map.set(n.id, { x: n.x * size.w, y: n.y * size.h, z });
    }
    return map;
  }, [nodes, size, mode]);

  const brainColor = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of brains) m.set(b.id, b.color);
    return m;
  }, [brains]);

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.min(2.5, Math.max(0.4, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    setZoom(next);
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.px + (e.clientX - dragRef.current.x),
      y: dragRef.current.py + (e.clientY - dragRef.current.y),
    });
  };
  const endDrag = () => (dragRef.current = null);

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden rounded-2xl border border-border bg-card/40 glass"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {/* Aurora backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "var(--gradient-aurora)", opacity: 0.7 }}
      />
      {/* Grid */}
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.15]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M40 0H0V40" fill="none" stroke="currentColor" strokeWidth="0.5" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" className="text-primary" />
      </svg>

      <svg
        width={size.w}
        height={size.h}
        className="relative z-10"
        style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map((e) => {
            const a = positions.get(e.source);
            const b = positions.get(e.target);
            if (!a || !b) return null;
            const active = selectedId && (e.source === selectedId || e.target === selectedId);
            return (
              <line
                key={e.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active ? "var(--neon-cyan)" : "currentColor"}
                strokeOpacity={active ? 0.9 : 0.25}
                strokeWidth={active ? 1.6 : 1}
                className="text-primary"
              />
            );
          })}

          {nodes.map((n) => {
            const p = positions.get(n.id);
            if (!p) return null;
            const isSel = n.id === selectedId;
            const r = (n.type === "agente" || n.type === "progetto" ? 9 : 6) + (mode === "3d" ? p.z * 4 : 0);
            const ring = brainColor.get(n.brainId) || "var(--primary)";
            const fill = TYPE_COLORS[n.type] || "var(--primary)";
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={(ev) => {
                  ev.stopPropagation();
                  onSelect(n.id);
                }}
                style={{ cursor: "pointer", color: fill }}
                className="animate-pulse-glow"
              >
                <circle r={r + 6} fill={ring} opacity={isSel ? 0.35 : 0.12} />
                <circle r={r} fill={fill} stroke={isSel ? "white" : ring} strokeWidth={isSel ? 2 : 1} />
                {(isSel || zoom > 1.1) && (
                  <text
                    y={-r - 8}
                    textAnchor="middle"
                    fontSize={11}
                    fill="currentColor"
                    className="text-foreground"
                    style={{ paintOrder: "stroke", stroke: "var(--background)", strokeWidth: 3 }}
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Controls */}
      <div className="absolute bottom-3 right-3 z-20 flex gap-2">
        <button
          onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))}
          className="rounded-md border border-border bg-card/80 px-2.5 py-1 text-sm hover:bg-accent/20"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.4, z / 1.15))}
          className="rounded-md border border-border bg-card/80 px-2.5 py-1 text-sm hover:bg-accent/20"
        >
          −
        </button>
        <button
          onClick={() => {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          }}
          className="rounded-md border border-border bg-card/80 px-2.5 py-1 text-xs hover:bg-accent/20"
        >
          Reset
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-1.5 rounded-md border border-border bg-card/70 p-2 text-[11px] glass">
        {Object.entries(TYPE_COLORS).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1 px-1">
            <span className="h-2 w-2 rounded-full" style={{ background: c }} />
            <span className="text-muted-foreground capitalize">{k}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
