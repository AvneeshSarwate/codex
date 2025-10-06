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
use url::Url;
use url::form_urlencoded;

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

fn ensure_producer_role(raw_url: &str) -> Result<String, url::ParseError> {
    let mut parsed = Url::parse(raw_url)?;
    let mut serializer = form_urlencoded::Serializer::new(String::new());
    for (key, value) in parsed.query_pairs().filter(|(key, _)| key != "role") {
        serializer.append_pair(&key, &value);
    }
    serializer.append_pair("role", "producer");
    let query = serializer.finish();
    parsed.set_query(Some(&query));
    Ok(parsed.into())
}

impl AgentVisualizer {
    pub(crate) fn from_env() -> Self {
        let url = std::env::var("CODEX_VISUALIZER_WS").ok();
        Self::new(url)
    }

    pub(crate) fn new(url: Option<String>) -> Self {
        if let Some(url) = url {
            let connect_url = match ensure_producer_role(&url) {
                Ok(prepared) => prepared,
                Err(err) => {
                    error!("failed to prepare visualizer websocket url: {err:?}");
                    url
                }
            };
            let (tx, mut rx) = mpsc::channel(256);
            tokio::spawn(async move {
                let mut pending: Option<VisualizerEvent> = None;
                let mut stream: Option<_> = None;
                let retry_delay = Duration::from_secs(1);

                'outer: loop {
                    if pending.is_none() {
                        match rx.recv().await {
                            Some(event) => pending = Some(event),
                            None => break,
                        }
                    }

                    let Some(event) = pending.take() else {
                        continue;
                    };

                    if stream.is_none() {
                        match connect_async(&connect_url).await {
                            Ok((ws, _)) => stream = Some(ws),
                            Err(err) => {
                                error!("failed to connect to visualizer websocket: {err:?}");
                                pending = Some(event);
                                tokio::time::sleep(retry_delay).await;
                                continue;
                            }
                        }
                    }

                    let serialized = match serde_json::to_string(&event) {
                        Ok(payload) => payload,
                        Err(err) => {
                            error!("failed to serialize visualizer event: {err:?}");
                            continue;
                        }
                    };

                    let send_result = match stream.as_mut() {
                        Some(ws) => ws.send(Message::Text(serialized)).await,
                        None => {
                            error!("visualizer websocket stream missing before send");
                            pending = Some(event);
                            tokio::time::sleep(retry_delay).await;
                            continue;
                        }
                    };

                    match send_result {
                        Ok(()) => loop {
                            match rx.try_recv() {
                                Ok(next) => {
                                    let serialized = match serde_json::to_string(&next) {
                                        Ok(payload) => payload,
                                        Err(err) => {
                                            error!("failed to serialize visualizer event: {err:?}");
                                            continue;
                                        }
                                    };

                                    let backlog_send = match stream.as_mut() {
                                        Some(ws) => ws.send(Message::Text(serialized)).await,
                                        None => {
                                            error!(
                                                "visualizer websocket stream missing before backlog send"
                                            );
                                            pending = Some(next);
                                            tokio::time::sleep(retry_delay).await;
                                            continue 'outer;
                                        }
                                    };

                                    if let Err(err) = backlog_send {
                                        error!("failed to send visualizer event: {err:?}");
                                        pending = Some(next);
                                        stream = None;
                                        tokio::time::sleep(retry_delay).await;
                                        continue 'outer;
                                    }
                                }
                                Err(mpsc::error::TryRecvError::Empty) => continue 'outer,
                                Err(mpsc::error::TryRecvError::Disconnected) => break 'outer,
                            }
                        },
                        Err(err) => {
                            error!("failed to send visualizer event: {err:?}");
                            pending = Some(event);
                            stream = None;
                            tokio::time::sleep(retry_delay).await;
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
