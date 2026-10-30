/**
 * Dataset Cryptographic Fingerprint Engine.
 * Conforms to SPEC-MOD-04 Case 15.
 */

import { computeSha256 } from "../../pipeline/hashing";
import { DatasetFingerprint, SchemaDiff } from "../contracts";

export async function computeDatasetFingerprint(
  schema: SchemaDiff | string,
  multisetHash: string,
  rowCount: number
): Promise<DatasetFingerprint> {
  const schemaHash =
    typeof schema === "string"
      ? await computeSha256(schema)
      : await computeSha256(JSON.stringify(schema));

  const fingerprintPayload = `${schemaHash}|${multisetHash}|${rowCount}`;
  const fingerprintHash = await computeSha256(fingerprintPayload);

  return {
    schema_hash: schemaHash,
    multiset_hash: multisetHash,
    row_count: rowCount,
    fingerprint_hash: fingerprintHash,
  };
}
