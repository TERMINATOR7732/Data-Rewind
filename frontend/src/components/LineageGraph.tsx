import React, { useMemo, useState } from "react";
import {
  Background,
  Controls,
  Edge,
  MarkerType,
  Node,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlertTriangle,
  CheckCircle,
  Database,
  Layers,
  List,
  ShieldAlert,
} from "lucide-react";
import { Investigation } from "../types/api";
import { LineageTableFallback } from "./LineageTableFallback";
import { TabularNum } from "./TabularNum";

interface LineageGraphProps {
  investigation: Investigation;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
}

export const LineageGraph: React.FC<LineageGraphProps> = ({
  investigation,
  selectedStepId,
  onSelectStep,
}) => {
  const [viewMode, setViewMode] = useState<"graph" | "table">("graph");

  const { topological_order, step_comparisons, eod_result, blast_radius, step_dependencies } =
    investigation;

  const eodStep = eod_result.primary_eod_step;
  const taintedSteps = useMemo(
    () => new Set(blast_radius.tainted_step_ids || []),
    [blast_radius.tainted_step_ids]
  );

  // Compute graph nodes and edges from topological order and step dependencies
  const { nodes, edges } = useMemo(() => {
    const calculatedNodes: Node[] = [];
    const calculatedEdges: Edge[] = [];

    // Position nodes along a clean left-to-right flow with alternating vertical offsets
    topological_order.forEach((sid, idx) => {
      const isEOD = sid === eodStep;
      const isTainted = taintedSteps.has(sid);
      const isSelected = sid === selectedStepId;
      const comp = step_comparisons[sid];

      const xPos = idx * 260 + 50;
      const yPos = (idx % 2 === 0 ? 100 : 220);

      calculatedNodes.push({
        id: sid,
        position: { x: xPos, y: yPos },
        data: {
          label: (
            <div
              onClick={() => onSelectStep(sid)}
              className={`p-3 rounded-lg border text-left cursor-pointer transition-all duration-200 select-none shadow-md ${
                isSelected
                  ? "bg-zinc-850 border-emerald-500 ring-2 ring-emerald-500/40"
                  : isEOD
                  ? "bg-amber-950/80 border-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.4)]"
                  : isTainted
                  ? "bg-zinc-900 border-rose-700/80 hover:border-rose-500"
                  : "bg-zinc-900 border-zinc-700/80 hover:border-zinc-500"
              }`}
              style={{ width: "210px" }}
            >
              {/* Node Header */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-xs font-bold text-zinc-100 flex items-center gap-1.5 truncate">
                  <Database className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
                  <span className="truncate">{sid}</span>
                </span>
                {isEOD && (
                  <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-900/80 text-amber-200 border border-amber-600 font-bold animate-pulse">
                    EOD
                  </span>
                )}
              </div>

              {/* Status and Metric */}
              <div className="text-[11px] font-mono flex items-center justify-between pt-1 border-t border-zinc-800">
                {comp ? (
                  comp.is_equal ? (
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Identical
                    </span>
                  ) : (
                    <span className="text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 text-amber-400" />
                      <TabularNum value={comp.modified_count} /> mod
                    </span>
                  )
                ) : (
                  <span className="text-zinc-500">No diff</span>
                )}

                {isTainted && !isEOD && (
                  <span className="text-rose-400 flex items-center gap-0.5 text-[10px]">
                    <ShieldAlert className="w-3 h-3" /> Tainted
                  </span>
                )}
              </div>
            </div>
          ),
        },
      });

      // Build edges based on dependencies
      const deps = step_dependencies?.[sid] || [];
      deps.forEach((dep) => {
        if (topological_order.includes(dep)) {
          const edgeTainted = isTainted || isEOD;
          calculatedEdges.push({
            id: `edge-${dep}->${sid}`,
            source: dep,
            target: sid,
            animated: edgeTainted,
            style: {
              stroke: edgeTainted ? "#f43f5e" : "#52525b",
              strokeWidth: edgeTainted ? 2 : 1.5,
            },
            markerEnd: {
              type: MarkerType.ArrowClosed,
              color: edgeTainted ? "#f43f5e" : "#71717a",
            },
          });
        }
      });
    });

    return { nodes: calculatedNodes, edges: calculatedEdges };
  }, [topological_order, step_comparisons, eodStep, taintedSteps, selectedStepId, step_dependencies, onSelectStep]);

  return (
    <div className="flex flex-col h-full bg-zinc-950 rounded-lg border border-zinc-800 overflow-hidden shadow-lg">
      {/* Canvas Top Bar */}
      <div className="p-3 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono font-semibold text-zinc-300 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-emerald-400" /> Pipeline DAG Lineage & Divergence Canvas
          </span>
          {eodStep && (
            <span className="px-2 py-0.5 rounded bg-amber-950/80 border border-amber-700 text-amber-200 text-xs font-mono">
              Earliest Divergence: <strong>{eodStep}</strong>
            </span>
          )}
        </div>

        {/* View Mode Toggle (Graph vs Table) */}
        <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded border border-zinc-800">
          <button
            onClick={() => setViewMode("graph")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              viewMode === "graph"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Graph Canvas
          </button>
          <button
            onClick={() => setViewMode("table")}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-colors ${
              viewMode === "table"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <List className="w-3.5 h-3.5" /> Accessible Table
          </button>
        </div>
      </div>

      {/* Main Graph or Accessible Fallback Table */}
      <div className="flex-1 w-full h-[400px] sm:h-[480px] relative bg-zinc-950">
        {viewMode === "graph" ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#27272a" gap={24} size={1} />
            <Controls className="bg-zinc-900 border border-zinc-800 text-zinc-300 fill-zinc-300 rounded shadow" />
          </ReactFlow>
        ) : (
          <div className="p-4 h-full overflow-auto">
            <LineageTableFallback
              investigation={investigation}
              selectedStepId={selectedStepId}
              onSelectStep={onSelectStep}
            />
          </div>
        )}
      </div>
    </div>
  );
};
