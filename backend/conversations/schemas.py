from pydantic import BaseModel, Field
from typing import Literal


class CreateConversationRequest(BaseModel):
    title: str = Field(default="New chat", max_length=200)
    paper_id: str | None = None


class SendMessageRequest(BaseModel):
    question: str = Field(min_length=1)


class MessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: Literal["user", "assistant"]
    content: str
    sources: list[dict] | None = None
    created_at: str


class ConversationResponse(BaseModel):
    id: str
    user_id: str
    title: str
    paper_id: str | None
    created_at: str
    updated_at: str


class ConversationDetailResponse(ConversationResponse):
    messages: list[MessageResponse]