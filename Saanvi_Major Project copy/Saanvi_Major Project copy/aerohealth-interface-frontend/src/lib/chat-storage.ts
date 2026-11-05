/**
 * Local storage for chat sessions
 * Persists conversations across browser sessions
 */

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  imageUrl?: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const STORAGE_KEY = 'aerohealth_chat_sessions';
const ACTIVE_SESSION_KEY = 'aerohealth_active_session';

/**
 * Load all chat sessions from localStorage
 */
export function loadChatSessions(): ChatSession[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    
    const sessions = JSON.parse(stored);
    // Convert date strings back to Date objects
    return sessions.map((s: any) => ({
      ...s,
      createdAt: new Date(s.createdAt),
      updatedAt: new Date(s.updatedAt),
      messages: s.messages.map((m: any) => ({
        ...m,
        timestamp: new Date(m.timestamp)
      }))
    }));
  } catch (error) {
    console.error('Failed to load chat sessions:', error);
    return [];
  }
}

/**
 * Save all chat sessions to localStorage
 */
export function saveChatSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (error) {
    console.error('Failed to save chat sessions:', error);
  }
}

/**
 * Create a new chat session
 */
export function createChatSession(title?: string): ChatSession {
  const session: ChatSession = {
    id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    title: title || 'New Chat',
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };
  
  const sessions = loadChatSessions();
  sessions.unshift(session); // Add to beginning
  saveChatSessions(sessions);
  setActiveSession(session.id);
  
  return session;
}

/**
 * Update an existing chat session
 */
export function updateChatSession(sessionId: string, updates: Partial<ChatSession>): void {
  const sessions = loadChatSessions();
  const index = sessions.findIndex(s => s.id === sessionId);
  const session = sessions[index];

  if (session) {
    sessions[index] = {
      ...session,
      ...updates,
      updatedAt: new Date()
    };
    saveChatSessions(sessions);
  }
}

/**
 * Delete a chat session
 */
export function deleteChatSession(sessionId: string): void {
  const sessions = loadChatSessions();
  const filtered = sessions.filter(s => s.id !== sessionId);
  saveChatSessions(filtered);
  
  // If we deleted the active session, clear it
  if (getActiveSessionId() === sessionId) {
    localStorage.removeItem(ACTIVE_SESSION_KEY);
  }
}

/**
 * Add a message to a session
 */
export function addMessageToSession(sessionId: string, message: ChatMessage): void {
  const sessions = loadChatSessions();
  const session = sessions.find(s => s.id === sessionId);
  
  if (session) {
    session.messages.push(message);
    session.updatedAt = new Date();
    
    // Auto-generate title from first user message
    if (session.title === 'New Chat' && message.role === 'user' && session.messages.length <= 2) {
      session.title = message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '');
    }
    
    saveChatSessions(sessions);
  }
}

/**
 * Get active session ID
 */
export function getActiveSessionId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY);
}

/**
 * Set active session
 */
export function setActiveSession(sessionId: string): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);
}

/**
 * Load a specific session
 */
export function loadChatSession(sessionId: string): ChatSession | null {
  const sessions = loadChatSessions();
  return sessions.find(s => s.id === sessionId) || null;
}

/**
 * Clear all chat sessions
 */
export function clearAllSessions(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(ACTIVE_SESSION_KEY);
}
