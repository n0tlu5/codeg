use super::delegation::transport::{AssistantActionResult, AssistantSessionList};
use async_trait::async_trait;

#[async_trait]
pub trait AssistantToolAccess: Send + Sync {
    async fn is_assistant_connection(&self, conn_id: &str) -> bool;
    async fn list_sessions(&self, exclude_conn_id: &str) -> AssistantSessionList;
    async fn focus_session(&self, session_id: i64) -> AssistantActionResult;
    async fn send_to_session(&self, session_id: i64, text: String) -> AssistantActionResult;
    async fn cancel_session(&self, session_id: i64) -> AssistantActionResult;
    async fn answer_permission(&self, session_id: i64, decision: String) -> AssistantActionResult;
    async fn start_session(
        &self,
        folder_id: i64,
        agent_type: String,
        task: String,
    ) -> AssistantActionResult;
}
