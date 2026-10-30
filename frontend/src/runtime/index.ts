/**
 * Data Rewind Browser-First Runtime Module.
 * Export barrel for execution contracts, typed protocol, error types,
 * CSV ingestion, IndexedDB and OPFS storage, run manifests, expression engine,
 * pipeline DAG execution, DuckDB-Wasm runtime, forensic intelligence,
 * historical replay, tri-run fix verification, report exporters, and archive services.
 */

export * from "./contracts/index";
export * from "./contracts/protocol";
export * from "./contracts/errors";
export * from "./csv/validator";
export * from "./csv/parser";
export * from "./storage/indexeddb";
export * from "./storage/opfs";
export * from "./storage/run-manifest";
export * from "./storage/storage-manager";
export * from "./expr/index";
export * from "./pipeline/index";
export * from "./forensics/index";
export * from "./replay/contracts";
export * from "./replay/replay-engine";
export * from "./verification/contracts";
export * from "./verification/tri-run-verifier";
export * from "./reports/formula-escaper";
export * from "./reports/json-exporter";
export * from "./reports/markdown-exporter";
export * from "./reports/csv-exporter";
export * from "./archive/archive-contracts";
export * from "./archive/archive-service";
export * from "./browser-runtime";
