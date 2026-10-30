/**
 * Data Rewind Browser-First Runtime Module.
 * Export barrel for execution contracts, typed protocol, error types,
 * CSV ingestion, IndexedDB and OPFS storage, and DuckDB-Wasm runtime.
 */

export * from "./contracts/index";
export * from "./contracts/protocol";
export * from "./contracts/errors";
export * from "./csv/validator";
export * from "./csv/parser";
export * from "./storage/indexeddb";
export * from "./storage/opfs";
export * from "./browser-runtime";
