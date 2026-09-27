use std::sync::Arc;

use async_trait::async_trait;

use crate::acp::assistant_tools::AssistantToolAccess;
use crate::acp::delegation::transport::{AssistantActionResult, AssistantSessionList};
use crate::acp::manager::ConnectionManager;
use crate::commands::assistant::ASSISTANT_OWNER_LABEL;
use crate::db::AppDatabase;
use crate::web::event_bridge::emit_event;
use crate::web::event_bridge::EventEmitter;

pub struct DbAssistantToolAccess {
    pub manager: Arc<ConnectionManager>,
    pub db: Arc<AppDatabase>,
    pub emitter: Arc<EventEmitter>,
}

#[async_trait]
impl AssistantToolAccess for DbAssistantToolAccess {
    async fn is_assistant_connection(&self, conn_id: &str) -> bool {
        self.manager
            .get_owner_window_label(conn_id)
            .await
            .as_deref()
            == Some(ASSISTANT_OWNER_LABEL)
    }

    async fn list_sessions(&self, exclude_conn_id: &str) -> AssistantSessionList {
        self.manager
            .list_linked_sessions(exclude_conn_id, &self.db)
            .await
    }

    async fn focus_session(&self, session_id: i64) -> AssistantActionResult {
        match crate::db::service::conversation_service::get_by_id(&self.db.conn, session_id as i32)
            .await
        {
            Ok(conv) => {
                let folder_id = conv.folder_id;
                let agent = serde_json::to_value(conv.agent_type)
                    .ok()
                    .and_then(|v| v.as_str().map(String::from))
                    .unwrap_or_default();
                #[derive(serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct FocusPayload {
                    folder_id: i32,
                    conversation_id: i32,
                    agent: String,
                }
                let payload = FocusPayload {
                    folder_id,
                    conversation_id: session_id as i32,
                    agent,
                };
                emit_event(&self.emitter, "workspace://focus-conversation", payload);

                #[cfg(feature = "tauri-runtime")]
                {
                    if let EventEmitter::Tauri(app_handle) = &*self.emitter {
                        crate::commands::windows::show_main_window(app_handle);
                    }
                }

                AssistantActionResult {
                    outcome: "ok".to_string(),
                    message: "focused".to_string(),
                }
            }
            Err(_) => AssistantActionResult {
                outcome: "not_found".to_string(),
                message: "session not found".to_string(),
            },
        }
    }

    async fn send_to_session(&self, _session_id: i64, _text: String) -> AssistantActionResult {
        AssistantActionResult {
            outcome: "disabled".to_string(),
            message: "not implemented yet".to_string(),
        }
    }

    async fn cancel_session(&self, _session_id: i64) -> AssistantActionResult {
        AssistantActionResult {
            outcome: "disabled".to_string(),
            message: "not implemented yet".to_string(),
        }
    }

    async fn answer_permission(
        &self,
        _session_id: i64,
        _decision: String,
    ) -> AssistantActionResult {
        AssistantActionResult {
            outcome: "disabled".to_string(),
            message: "not implemented yet".to_string(),
        }
    }

    async fn start_session(
        &self,
        _folder_id: i64,
        _agent_type: String,
        _task: String,
    ) -> AssistantActionResult {
        AssistantActionResult {
            outcome: "disabled".to_string(),
            message: "not implemented yet".to_string(),
        }
    }
}
