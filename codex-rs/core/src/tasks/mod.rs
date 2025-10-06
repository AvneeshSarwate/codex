mod compact;
mod regular;
mod review;

use std::sync::Arc;

use async_trait::async_trait;
use tracing::trace;

use crate::codex::Session;
use crate::codex::TurnContext;
use crate::protocol::Event;
use crate::protocol::EventMsg;
use crate::protocol::InputItem;
use crate::protocol::TaskCompleteEvent;
use crate::protocol::TurnAbortReason;
use crate::protocol::TurnAbortedEvent;
use crate::state::ActiveTurn;
use crate::state::RunningTask;
use crate::state::TaskKind;
use serde_json::json;

pub(crate) use compact::CompactTask;
pub(crate) use regular::RegularTask;
pub(crate) use review::ReviewTask;

/// Thin wrapper that exposes the parts of [`Session`] task runners need.
#[derive(Clone)]
pub(crate) struct SessionTaskContext {
    session: Arc<Session>,
}

impl SessionTaskContext {
    pub(crate) fn new(session: Arc<Session>) -> Self {
        Self { session }
    }

    pub(crate) fn clone_session(&self) -> Arc<Session> {
        Arc::clone(&self.session)
    }
}

#[async_trait]
pub(crate) trait SessionTask: Send + Sync + 'static {
    fn kind(&self) -> TaskKind;

    async fn run(
        self: Arc<Self>,
        session: Arc<SessionTaskContext>,
        ctx: Arc<TurnContext>,
        sub_id: String,
        input: Vec<InputItem>,
    ) -> Option<String>;

    async fn abort(&self, session: Arc<SessionTaskContext>, sub_id: &str) {
        let _ = (session, sub_id);
    }
}

impl Session {
    /// Visualization hook: every task represents a new agent phase (plan,
    /// edit, test, review, auto-compact). Emit an event here with the new
    /// `sub_id`, `task.kind()`, and size of the `input` vector so the UI can
    /// show task lifetimes and understand which payload kicked off the phase.
    pub async fn spawn_task<T: SessionTask>(
        self: &Arc<Self>,
        turn_context: Arc<TurnContext>,
        sub_id: String,
        input: Vec<InputItem>,
        task: T,
    ) {
        // Visualization hook: aborting older tasks maps to timeline branches
        // getting cancelled (interrupts, plan revisions). Emit telemetry that
        // lists each aborted task's `TaskKind` and the `TurnAbortReason` so
        // guardrail events can explain why lanes disappeared.
        self.abort_all_tasks(TurnAbortReason::Replaced).await;

        let task: Arc<dyn SessionTask> = Arc::new(task);
        let task_kind = task.kind();
        let input_len = input.len();

        let handle = {
            let session_ctx = Arc::new(SessionTaskContext::new(Arc::clone(self)));
            let ctx = Arc::clone(&turn_context);
            let task_for_run = Arc::clone(&task);
            let sub_clone = sub_id.clone();
            tokio::spawn(async move {
                let last_agent_message = task_for_run
                    .run(Arc::clone(&session_ctx), ctx, sub_clone.clone(), input)
                    .await;
                // Emit completion uniformly from spawn site so all tasks share the same lifecycle.
                let sess = session_ctx.clone_session();
                sess.on_task_finished(sub_clone, last_agent_message).await;
            })
            .abort_handle()
        };

        let running_task = RunningTask {
            handle,
            kind: task_kind,
            task,
        };
        // Visualization hook: track the moment a task becomes "active" by
        // logging the `sub_id`, `task.kind`, and optional approval/tool state so
        // the visualization can light up the corresponding lane.
        self.register_new_active_task(sub_id.clone(), running_task)
            .await;
        self.emit_with_state(
            "task_spawned",
            json!({
                "subId": sub_id,
                "taskKind": format!("{:?}", task_kind),
                "inputItems": input_len,
                "cwd": turn_context.cwd.display().to_string(),
                "isReviewMode": turn_context.is_review_mode,
            }),
        )
        .await;
    }

    pub async fn abort_all_tasks(self: &Arc<Self>, reason: TurnAbortReason) {
        for (sub_id, task) in self.take_all_running_tasks().await {
            self.handle_task_abort(sub_id, task, reason.clone()).await;
        }
    }

    pub async fn on_task_finished(
        self: &Arc<Self>,
        sub_id: String,
        last_agent_message: Option<String>,
    ) {
        let mut active = self.active_turn.lock().await;
        if let Some(at) = active.as_mut()
            && at.remove_task(&sub_id)
        {
            *active = None;
        }
        drop(active);
        // Visualization hook: TaskComplete closes the lane and carries the
        // assistant's final message for the phase. Emit the `sub_id` and
        // `last_agent_message` alongside completion timestamps so latency can
        // be derived relative to the spawn event.
        let completion_preview = last_agent_message.clone();
        let event = Event {
            id: sub_id.clone(),
            msg: EventMsg::TaskComplete(TaskCompleteEvent { last_agent_message }),
        };
        self.send_event(event).await;
        self.emit_with_state(
            "task_completed",
            json!({
                "subId": sub_id,
                "lastAgentMessage": completion_preview,
            }),
        )
        .await;
    }

    async fn register_new_active_task(&self, sub_id: String, task: RunningTask) {
        let mut active = self.active_turn.lock().await;
        let mut turn = ActiveTurn::default();
        turn.add_task(sub_id, task);
        *active = Some(turn);
    }

    async fn take_all_running_tasks(&self) -> Vec<(String, RunningTask)> {
        let mut active = self.active_turn.lock().await;
        match active.take() {
            Some(mut at) => {
                at.clear_pending().await;
                let tasks = at.drain_tasks();
                tasks.into_iter().collect()
            }
            None => Vec::new(),
        }
    }

    async fn handle_task_abort(
        self: &Arc<Self>,
        sub_id: String,
        task: RunningTask,
        reason: TurnAbortReason,
    ) {
        if task.handle.is_finished() {
            return;
        }

        let task_kind = task.kind;
        trace!(task_kind = ?task.kind, sub_id, "aborting running task");
        let session_task = task.task;
        let handle = task.handle;
        handle.abort();
        let session_ctx = Arc::new(SessionTaskContext::new(Arc::clone(self)));
        session_task.abort(session_ctx, &sub_id).await;

        let reason_text = format!("{:?}", reason);
        let event = Event {
            id: sub_id.clone(),
            msg: EventMsg::TurnAborted(TurnAbortedEvent { reason }),
        };
        self.send_event(event).await;
        self.emit_with_state(
            "task_aborted",
            json!({
                "subId": sub_id,
                "taskKind": format!("{:?}", task_kind),
                "reason": reason_text,
            }),
        )
        .await;
    }
}

#[cfg(test)]
mod tests {}
