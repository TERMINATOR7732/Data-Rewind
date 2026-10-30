/**
 * Data Rewind JSON Forensic Dossier Exporter.
 * Conforms strictly to SPEC-MOD-05 §2.1.
 */

import { ForensicDossier } from "../../types/api";

export class JSONDossierExporter {
  /**
   * Export complete forensic investigation dossier to formatted JSON string.
   */
  static export(dossier: ForensicDossier, indent: number = 2): string {
    return JSON.stringify(dossier, null, indent);
  }
}
