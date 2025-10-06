use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::time::Duration;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use codex_protocol::ConversationId;
use futures::SinkExt;
use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tracing::debug;
use tracing::error;
use tracing::warn;
use url::Url;

#[derive(Clone)]
pub(crate) struct AgentVisualizer {
    sender: Option<mpsc::Sender<VisualizerEvent>>,
    sequence: Arc<AtomicU64>,
}

#[derive(Clone)]
pub(crate) struct SessionVisualizer {
    inner: AgentVisualizer,
    conversation_id: ConversationId,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VisualizerEvent {
    pub(crate) sequence: u64,
    pub(crate) timestamp_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) conversation_id: Option<ConversationId>,
    pub(crate) action_type: String,
    pub(crate) action: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) state: Option<Value>,
}

impl AgentVisualizer {
    pub(crate) fn from_env() -> Self {
        let url = std::env::var("CODEX_VISUALIZER_WS").ok();
        Self::new(url)
    }

    pub(crate) fn new(url: Option<String>) -> Self {
        if let Some(url) = url.and_then(Self::normalize_url) {
            let (tx, mut rx) = mpsc::channel(256);
            let url = Arc::new(url);
            tokio::spawn(async move {
                let mut pending = VecDeque::<VisualizerEvent>::new();
                let mut backoff = Duration::from_secs(1);
                let mut stream = None;

                loop {
                    let next_event = if let Some(event) = pending.pop_front() {
                        Some(event)
                    } else {
                        rx.recv().await
                    };

                    let Some(event) = next_event else {
                        break;
                    };

                    let stream_ref = match stream.as_mut() {
                        Some(existing) => existing,
                        None => match connect_async(url.as_ref()).await {
                            Ok((ws, _)) => {
                                backoff = Duration::from_secs(1);
                                stream = Some(ws);
                                stream.as_mut().expect("stream newly set")
                            }
                            Err(err) => {
                                error!("failed to connect to visualizer websocket: {err:?}");
                                pending.push_front(event);
                                tokio::time::sleep(backoff).await;
                                backoff = (backoff.saturating_mul(2)).min(Duration::from_secs(30));
                                continue;
                            }
                        },
                    };

                    let serialized = match serde_json::to_string(&event) {
                        Ok(payload) => payload,
                        Err(err) => {
                            error!("failed to serialize visualizer event: {err:?}");
                            pending.push_front(event);
                            continue;
                        }
                    };

                    match stream_ref.send(Message::Text(serialized)).await {
                        Ok(()) => {
                            while let Ok(event) = rx.try_recv() {
                                pending.push_back(event);
                            }
                        }
                        Err(err) => {
                            error!("failed to send visualizer event: {err:?}");
                            pending.push_front(event);
                            if let Some(mut ws) = stream.take() {
                                if let Err(close_err) = ws.close(None).await {
                                    debug!(
                                        "failed to close visualizer websocket cleanly: {close_err:?}"
                                    );
                                }
                            }
                            tokio::time::sleep(backoff).await;
                            backoff = (backoff.saturating_mul(2)).min(Duration::from_secs(30));
                        }
                    }
                }

                if let Some(mut ws) = stream {
                    if let Err(err) = ws.close(None).await {
                        debug!("failed to close visualizer websocket cleanly: {err:?}");
                    }
                }

                debug!("visualizer channel closed; stopping websocket forwarder");
            });

            Self {
                sender: Some(tx),
                sequence: Arc::new(AtomicU64::new(0)),
            }
        } else {
            Self {
                sender: None,
                sequence: Arc::new(AtomicU64::new(0)),
            }
        }
    }

    fn normalize_url(raw: String) -> Option<String> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }

        let mut attempts = Vec::from([trimmed.to_string()]);
        if !trimmed.contains("://") {
            attempts.push(format!("ws://{trimmed}"));
        }

        for candidate in attempts {
            match Url::parse(&candidate) {
                Ok(mut parsed) => {
                    let has_role = parsed.query_pairs().any(|(key, _)| key == "role");
                    if !has_role {
                        parsed.query_pairs_mut().append_pair("role", "producer");
                    }
                    return Some(parsed.into());
                }
                Err(err) => {
                    warn!("invalid visualizer websocket url '{candidate}': {err:#}");
                }
            }
        }

        warn!("falling back to raw CODEX_VISUALIZER_WS value without validation");
        Some(trimmed.to_string())
    }

    pub(crate) async fn emit(
        &self,
        conversation_id: Option<ConversationId>,
        action_type: impl Into<String>,
        action: Value,
        state: Option<Value>,
    ) {
        if let Some(tx) = &self.sender {
            let timestamp_ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_else(|_| Duration::from_secs(0))
                .as_millis();
            let sequence = self.sequence.fetch_add(1, Ordering::SeqCst);
            let event = VisualizerEvent {
                sequence,
                timestamp_ms,
                conversation_id,
                action_type: action_type.into(),
                action,
                state,
            };
            if tx.send(event).await.is_err() {
                debug!("visualizer channel dropped; disabling event stream");
            }
        }
    }
}

impl Default for AgentVisualizer {
    fn default() -> Self {
        Self::new(None)
    }
}

impl SessionVisualizer {
    pub(crate) fn new(inner: AgentVisualizer, conversation_id: ConversationId) -> Self {
        Self {
            inner,
            conversation_id,
        }
    }

    pub(crate) async fn emit(
        &self,
        action_type: impl Into<String>,
        action: Value,
        state: Option<Value>,
    ) {
        self.inner
            .emit(Some(self.conversation_id), action_type, action, state)
            .await;
    }
}
