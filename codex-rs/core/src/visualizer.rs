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
        if let Some(url) = url {
            let (tx, mut rx) = mpsc::channel(256);
            tokio::spawn(async move {
                let mut pending: Option<VisualizerEvent> = None;
                loop {
                    if pending.is_none() {
                        match rx.recv().await {
                            Some(event) => pending = Some(event),
                            None => break,
                        }
                    }

                    let Some(event) = pending.take() else {
                        continue;
                    };

                    match connect_async(&url).await {
                        Ok((mut stream, _)) => {
                            let serialized = match serde_json::to_string(&event) {
                                Ok(payload) => payload,
                                Err(err) => {
                                    error!("failed to serialize visualizer event: {err:?}");
                                    continue;
                                }
                            };

                            match stream.send(Message::Text(serialized)).await {
                                Ok(()) => {
                                    pending = None;
                                    while let Ok(next) = rx.try_recv() {
                                        let serialized = match serde_json::to_string(&next) {
                                            Ok(payload) => payload,
                                            Err(err) => {
                                                error!(
                                                    "failed to serialize visualizer event: {err:?}"
                                                );
                                                continue;
                                            }
                                        };

                                        if let Err(err) =
                                            stream.send(Message::Text(serialized)).await
                                        {
                                            error!("failed to send visualizer event: {err:?}");
                                            pending = Some(next);
                                            break;
                                        }
                                    }
                                }
                                Err(err) => {
                                    error!("failed to send visualizer event: {err:?}");
                                    pending = Some(event);
                                    tokio::time::sleep(Duration::from_secs(1)).await;
                                }
                            }
                        }
                        Err(err) => {
                            error!("failed to connect to visualizer websocket: {err:?}");
                            pending = Some(event);
                            tokio::time::sleep(Duration::from_secs(1)).await;
                        }
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
