import { useSyncExternalStore } from 'react'
import type { Conversation } from './conversation'
import type { ConversationState } from './reducer'

export function useConversation(conversation: Conversation): ConversationState {
  return useSyncExternalStore(conversation.subscribe, conversation.getState)
}
