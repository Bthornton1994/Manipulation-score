// Normalize a graph for golden-file comparison: replace the fields that are
// expected to differ between runs (graph_id, generated_at, engine
// timestamps) with fixed placeholders. Everything else, including derived
// observations/claims/coverage, must match exactly.

const PLACEHOLDER_GRAPH_ID = '00000000-0000-0000-0000-000000000000';
const PLACEHOLDER_TIMESTAMP = '2000-01-01T00:00:00.000Z';

export function normalizeForGolden(graph) {
  const clone = JSON.parse(JSON.stringify(graph));
  clone.graph_id = PLACEHOLDER_GRAPH_ID;
  clone.generated_at = PLACEHOLDER_TIMESTAMP;
  if (clone.engine?.timestamps) {
    clone.engine.timestamps.started_at = PLACEHOLDER_TIMESTAMP;
    clone.engine.timestamps.completed_at = PLACEHOLDER_TIMESTAMP;
  }
  if (typeof clone.engine?.jev?.elapsed_ms === 'number') {
    clone.engine.jev.elapsed_ms = 0;
  }
  if (typeof clone.engine?.classifier_dev?.elapsed_ms === 'number') {
    clone.engine.classifier_dev.elapsed_ms = 0;
  }
  return clone;
}
