import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Clock,
  HelpCircle,
  PlusCircle,
  MinusCircle,
  RefreshCw,
  XCircle,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { VerificationVerdictCode, DiffCategory } from "../types/api";

interface StatusBadgeProps {
  status: VerificationVerdictCode | DiffCategory | string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = "md", className = "" }) => {
  const norm = String(status).toUpperCase();

  let colorClasses = "bg-zinc-800 text-zinc-300 border-zinc-700";
  let icon: React.ReactNode = <HelpCircle className="w-3.5 h-3.5" />;
  let label = norm;

  switch (norm) {
    // Verification Verdicts (SPEC-MOD-05 §1.3)
    case "VERIFIED_CLEAN":
      colorClasses = "bg-emerald-950/80 text-emerald-300 border-emerald-800";
      icon = <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />;
      label = "VERIFIED CLEAN";
      break;
    case "INTENTIONAL_UPDATE":
      colorClasses = "bg-sky-950/80 text-sky-300 border-sky-800";
      icon = <CheckCircle className="w-3.5 h-3.5 text-sky-400" />;
      label = "INTENTIONAL UPDATE";
      break;
    case "PARTIAL_RESTORATION":
      colorClasses = "bg-amber-950/80 text-amber-300 border-amber-800";
      icon = <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />;
      label = "PARTIAL RESTORATION";
      break;
    case "REGRESSION_UNRESOLVED":
      colorClasses = "bg-rose-950/80 text-rose-300 border-rose-800";
      icon = <XCircle className="w-3.5 h-3.5 text-rose-400" />;
      label = "REGRESSION UNRESOLVED";
      break;
    case "NEW_FAULT_INTRODUCED":
      colorClasses = "bg-rose-950/90 text-rose-200 border-rose-700 font-bold";
      icon = <ShieldAlert className="w-3.5 h-3.5 text-rose-400 animate-pulse" />;
      label = "NEW FAULT INTRODUCED";
      break;
    case "BASELINE_UNAVAILABLE":
      colorClasses = "bg-zinc-900 text-zinc-300 border-zinc-700";
      icon = <AlertCircle className="w-3.5 h-3.5 text-zinc-400" />;
      label = "BASELINE UNAVAILABLE";
      break;
    case "FAULT_UNREPRODUCIBLE":
      colorClasses = "bg-amber-950/60 text-amber-300 border-amber-800";
      icon = <AlertCircle className="w-3.5 h-3.5 text-amber-400" />;
      label = "FAULT UNREPRODUCIBLE";
      break;
    case "INCONCLUSIVE_VERIFICATION":
      colorClasses = "bg-zinc-900 text-zinc-300 border-zinc-700";
      icon = <HelpCircle className="w-3.5 h-3.5 text-zinc-400" />;
      label = "INCONCLUSIVE";
      break;

    // Diff Categories
    case "IDENTICAL":
      colorClasses = "bg-emerald-950/60 text-emerald-300 border-emerald-800/80";
      icon = <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      label = "IDENTICAL";
      break;
    case "MODIFIED":
      colorClasses = "bg-amber-950/70 text-amber-300 border-amber-800";
      icon = <RefreshCw className="w-3.5 h-3.5 text-amber-400" />;
      label = "MODIFIED";
      break;
    case "ADDED":
      colorClasses = "bg-sky-950/70 text-sky-300 border-sky-800";
      icon = <PlusCircle className="w-3.5 h-3.5 text-sky-400" />;
      label = "ADDED";
      break;
    case "REMOVED":
      colorClasses = "bg-rose-950/70 text-rose-300 border-rose-800";
      icon = <MinusCircle className="w-3.5 h-3.5 text-rose-400" />;
      label = "REMOVED";
      break;

    // Execution Lifecycle
    case "COMPLETED":
    case "SUCCESS":
      colorClasses = "bg-emerald-950/60 text-emerald-300 border-emerald-800";
      icon = <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />;
      break;
    case "RUNNING":
      colorClasses = "bg-sky-950/60 text-sky-300 border-sky-800";
      icon = <RefreshCw className="w-3.5 h-3.5 text-sky-400 animate-spin" />;
      break;
    case "PENDING":
      colorClasses = "bg-zinc-900 text-zinc-400 border-zinc-800";
      icon = <Clock className="w-3.5 h-3.5" />;
      break;
    case "FAILED":
      colorClasses = "bg-rose-950/80 text-rose-300 border-rose-800";
      icon = <XCircle className="w-3.5 h-3.5 text-rose-400" />;
      break;
  }

  const sizeClasses =
    size === "sm"
      ? "text-[11px] px-2 py-0.5 gap-1.5"
      : size === "lg"
      ? "text-sm px-3.5 py-1.5 gap-2"
      : "text-xs px-2.5 py-1 gap-1.5";

  return (
    <span
      className={`inline-flex items-center font-mono font-medium rounded border ${colorClasses} ${sizeClasses} ${className}`}
      role="status"
      aria-label={`Status: ${label}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
};
