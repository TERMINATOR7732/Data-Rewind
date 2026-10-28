import React from "react";

interface TabularNumProps {
  value: number | string | null | undefined;
  format?: "integer" | "decimal" | "bytes" | "percentage" | "currency";
  className?: string;
}

export const TabularNum: React.FC<TabularNumProps> = ({
  value,
  format = "integer",
  className = "",
}) => {
  if (value === null || value === undefined) {
    return <span className={`font-mono text-zinc-500 tabular-nums ${className}`}>—</span>;
  }

  const num = typeof value === "string" ? parseFloat(value) : value;

  let formatted = String(value);

  if (!isNaN(num)) {
    if (format === "integer") {
      formatted = Math.round(num).toLocaleString("en-US");
    } else if (format === "decimal") {
      formatted = num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    } else if (format === "percentage") {
      formatted = `${(num * 100).toFixed(1)}%`;
    } else if (format === "currency") {
      formatted = `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (format === "bytes") {
      if (num >= 1_000_000) {
        formatted = `${(num / 1_000_000).toFixed(2)} MB`;
      } else if (num >= 1_000) {
        formatted = `${(num / 1_000).toFixed(1)} KB`;
      } else {
        formatted = `${num} B`;
      }
    }
  }

  return (
    <span className={`font-mono tabular-nums font-medium tracking-tight ${className}`}>
      {formatted}
    </span>
  );
};
