export const actionColors: Record<string, string> = {
  memory_bootstrap: "#2563eb",
  session_loop_started: "#7c3aed",
  protocol_event: "#334155",
  task_spawned: "#16a34a",
  task_completed: "#0ea5e9",
  task_aborted: "#f97316",
  task_started: "#0f766e",
  tool_catalog_snapshot: "#4f46e5",
  llm_prompt_prepared: "#2563eb",
  llm_stream_started: "#f59e0b",
  llm_response_complete: "#14b8a6",
  llm_retry_scheduled: "#ef4444",
  turn_context_persisted: "#8b5cf6"
};

export const defaultActionColor = "#1f2937";
export const stateBackground = "#f8fafc";
export const actionBackground = "#ffffff";

export function colorForAction(actionType: string): string {
  return actionColors[actionType] ?? defaultActionColor;
}
