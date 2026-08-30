import { randomUUID } from 'node:crypto';

export function createConversationStore({
  idFactory = randomUUID,
  now = () => new Date().toISOString(),
  maxMessages = 50,
} = {}) {
  const conversations = new Map();

  function requireConversation(id) {
    const conversation = conversations.get(id);
    if (!conversation) throw new Error('Conversation not found');
    return conversation;
  }

  function append(id, { role, text, kind }) {
    const conversation = requireConversation(id);
    if (role !== 'user' && role !== 'assistant') {
      throw new Error('Conversation message role must be user or assistant');
    }
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Conversation message requires non-empty text');
    }
    const createdAt = now();
    const message = { id: idFactory(), role, text: text.trim(), kind, createdAt };
    conversation.messages.push(message);
    conversation.messages = conversation.messages.slice(-maxMessages);
    conversation.updatedAt = createdAt;
    return message;
  }

  return {
    create({ brief }) {
      if (typeof brief !== 'string' || !brief.trim()) {
        throw new Error('Conversation brief requires non-empty text');
      }
      const id = idFactory();
      const createdAt = now();
      const conversation = {
        id,
        createdAt,
        updatedAt: createdAt,
        messages: [],
        activeInvestigation: null,
      };
      conversations.set(id, conversation);
      append(id, { role: 'user', text: brief, kind: 'brief' });
      return conversation;
    },

    get(id) {
      return conversations.get(id);
    },

    append,

    setActiveInvestigation(id, investigation) {
      const conversation = requireConversation(id);
      conversation.activeInvestigation = structuredClone(investigation);
      conversation.updatedAt = now();
      return conversation.activeInvestigation;
    },

    invalidatePendingApproval(id) {
      const conversation = requireConversation(id);
      if (conversation.activeInvestigation) {
        conversation.activeInvestigation.approvalToken = undefined;
        conversation.activeInvestigation.status = 'replaced';
        conversation.updatedAt = now();
      }
    },

    publicView(id) {
      const conversation = structuredClone(requireConversation(id));
      if (conversation.activeInvestigation) {
        delete conversation.activeInvestigation.approvalToken;
      }
      return conversation;
    },
  };
}
