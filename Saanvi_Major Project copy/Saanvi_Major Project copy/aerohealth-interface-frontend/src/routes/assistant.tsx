import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, Sparkles, TrendingUp, MapPin, Heart, Loader2, Mic, Volume2, 
  Image as ImageIcon, Menu, X, MessageSquarePlus, Trash2, StopCircle 
} from "lucide-react";
import { EASE } from "@/lib/aero/ui";
import { streamGrokChat, speakResponse, generateVisualization, transcribeSpeech } from "@/lib/puter-ai";
import { PROJECT_CONTEXT, readLiveContext } from "@/lib/aero/live-context";
import {
  loadChatSessions,
  createChatSession,
  deleteChatSession,
  addMessageToSession,
  getActiveSessionId,
  setActiveSession,
  loadChatSession,
  type ChatSession,
  type ChatMessage
} from "@/lib/chat-storage";

export const Route = createFileRoute("/assistant")({
  component: AssistantPage,
  validateSearch: (search: Record<string, unknown>) => {
    return {
      prompt: (search["prompt"] as string) || undefined,
      context: (search["context"] as string) || undefined,
    };
  },
});

// Get context from URL search params or global state
function useAppContext() {
  const live = readLiveContext();
  const liveRisk = live.risk_data as { risk_score?: number; risk_label?: string } | undefined;
  return {
    ...PROJECT_CONTEXT,
    ...live,
    location: live.location || "your current location",
    aqi: live.aqi_data?.aqi ?? 0,
    riskScore: liveRisk?.risk_score ?? 0,
    riskLabel: liveRisk?.risk_label ?? "Unknown",
    vitals: live.vitals || {
      age: 30,
      heart_rate: 75,
      asthma: false
    },
    topRiskFactors: live.shap_data?.features?.slice(0, 3) || [],
  };
}

function AssistantPage() {
  const context = useAppContext();
  const search = Route.useSearch();
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [currentStream, setCurrentStream] = useState("");
  const [recording, setRecording] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [puterInitErrorState, setPuterInitErrorState] = useState<string | null>(null);
  const [tryingPuterInit, setTryingPuterInit] = useState(false);
  const [showImageGen, setShowImageGen] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  function getConversationContext() {
    const live = readLiveContext();
    if (!search.context) return { ...context, ...live, route_data: live.route_data };
    try {
      const incoming = JSON.parse(search.context) as Record<string, unknown>;
      return {
        ...context,
        ...live,
        ...incoming,
        route_data: incoming["route_data"] ?? (incoming["safe_route"] ? incoming : live.route_data),
      };
    } catch {
      return context;
    }
  }

  // Load sessions on mount
  useEffect(() => {
    const savedSessions = loadChatSessions();
    setSessions(savedSessions);
    
    const activeId = getActiveSessionId();
    if (activeId && savedSessions.find(s => s.id === activeId)) {
      loadSession(activeId);
    } else if (savedSessions[0]) {
      loadSession(savedSessions[0].id);
    } else {
      // Create first session
      handleNewChat();
    }

    // read bootstrap diagnostics attached by puter-boot.ts
    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const initErr = window.puterInitError ?? null;
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      const ready = window.puterReady ?? null;
      if (initErr) setPuterInitErrorState(String(initErr));
      else if (!ready && !window.puter) setPuterInitErrorState('Puter SDK not initialized');
    } catch (e) {
      // ignore
    }
  }, []);

  // Handle incoming prompt from URL params
  useEffect(() => {
    if (search.prompt && activeSessionId) {
      // Parse context if provided
      // Send the message automatically
      setInput(search.prompt);
      setTimeout(() => {
        sendMessage(search.prompt);
      }, 500);
    }
  }, [search.prompt, activeSessionId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentStream]);

  function loadSession(sessionId: string) {
    const session = loadChatSession(sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      setActiveSession(sessionId);
      setMessages(session.messages);
    }
  }

  function handleNewChat() {
    const newSession = createChatSession();
    const welcomeMessage: ChatMessage = {
      role: "assistant",
      content: `👋 Welcome! I'm your AeroHealth AI Assistant.\n\nI can see you're in ${context.location} with:\n• AQI: ${context.aqi}\n• Risk Score: ${context.riskScore}/100 (${context.riskLabel})\n\nI can help you:\n✨ Understand your health data\n🎤 Chat via voice\n🖼️ Generate visualizations\n🚗 Plan safer routes\n\nWhat would you like to know?`,
      timestamp: new Date()
    };
    
    addMessageToSession(newSession.id, welcomeMessage);
    setSessions([newSession, ...sessions]);
    loadSession(newSession.id);
  }

  function handleDeleteSession(sessionId: string) {
    deleteChatSession(sessionId);
    const remaining = sessions.filter(s => s.id !== sessionId);
    setSessions(remaining);
    
    if (sessionId === activeSessionId) {
      if (remaining[0]) {
        loadSession(remaining[0].id);
      } else {
        handleNewChat();
      }
    }
  }

  async function sendMessage(messageText?: string) {
    if (!activeSessionId) return;
    
    const textToSend = messageText || input.trim();
    if (!textToSend || streaming) return;

    const userMessage: ChatMessage = {
      role: "user",
      content: textToSend,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    addMessageToSession(activeSessionId, userMessage);
    setInput("");
    setStreaming(true);
    setCurrentStream("");

    try {
      const conversationHistory = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content
      }));
      const conversationContext = getConversationContext();

      let accumulatedText = "";
      
      for await (const chunk of streamGrokChat(conversationHistory, conversationContext)) {
        accumulatedText += chunk;
        setCurrentStream(accumulatedText);
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: accumulatedText,
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, assistantMessage]);
      addMessageToSession(activeSessionId, assistantMessage);
      setCurrentStream("");
      
      // Reload sessions to update titles
      setSessions(loadChatSessions());

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage: ChatMessage = {
        role: "assistant",
        content: "⚠️ I'm having trouble connecting. Please check your internet and try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
      addMessageToSession(activeSessionId, errorMessage);
    } finally {
      setStreaming(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: BlobPart[] = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        try {
          const transcript = await transcribeSpeech(audioBlob as any);
          setInput(prev => prev + ' ' + transcript);
        } catch (error) {
          console.error('Transcription error:', error);
        }
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
    } catch (error) {
      console.error('Microphone error:', error);
      alert('Could not access microphone');
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  }

  async function speakMessage(text: string) {
    if (speaking) return;
    
    setSpeaking(true);
    try {
      const audio = await speakResponse(text, 'eve');
      audio.onended = () => setSpeaking(false);
      await audio.play();
    } catch (error) {
      console.error('TTS error:', error);
      setSpeaking(false);
    }
  }

  async function generateImage() {
    if (!imagePrompt.trim() || !activeSessionId) return;
    
    setShowImageGen(false);
    const genMessage: ChatMessage = {
      role: "assistant",
      content: `🎨 Generating: "${imagePrompt}"...`,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, genMessage]);
    
    try {
      const image = await generateVisualization(imagePrompt);
      const imageMessage: ChatMessage = {
        role: "assistant",
        content: "Here's your visualization:",
        timestamp: new Date(),
        imageUrl: image.src
      };
      setMessages(prev => [...prev, imageMessage]);
      addMessageToSession(activeSessionId, imageMessage);
      setImagePrompt("");
    } catch (error) {
      console.error('Image generation error:', error);
      const errorMsg: ChatMessage = {
        role: "assistant",
        content: "⚠️ Could not generate image. Please try again.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const quickPrompts = [
    { icon: <TrendingUp size={14} />, text: "Explain my risk", prompt: `Why is my risk score ${context.riskScore}? What's contributing most?` },
    { icon: <MapPin size={14} />, text: "Safest route?", prompt: "Should I take a safe route today or is the air quality okay?" },
    { icon: <Heart size={14} />, text: "Today's precautions", prompt: `Given AQI ${context.aqi} and my risk of ${context.riskScore}, what precautions should I take?` },
    { icon: <ImageIcon size={14} />, text: "Visualize data", prompt: "Create a visualization showing how today's air quality affects my health" }
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="w-[280px] border-r border-hairline bg-surface-1 flex flex-col"
          >
            {/* Sidebar header */}
            <div className="p-4 border-b border-hairline">
              <button
                onClick={handleNewChat}
                className="w-full press flex items-center justify-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
              >
                <MessageSquarePlus size={16} />
                <span>New Chat</span>
              </button>
            </div>

            {/* Chat history */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className={`group relative rounded-lg transition-colors ${
                    session.id === activeSessionId
                      ? 'bg-primary/10 border border-primary/20'
                      : 'hover:bg-surface-2 border border-transparent'
                  }`}
                >
                  <button
                    onClick={() => loadSession(session.id)}
                    className="w-full text-left px-3 py-2.5 text-sm truncate"
                  >
                    {session.title}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(session.id);
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 press p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-500 transition-all"
                    title="Delete chat"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Sidebar footer */}
            <div className="p-4 border-t border-hairline text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <div className="size-2 rounded-full bg-green-500 animate-pulse" />
                <span>AI Assistant Active</span>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="h-16 border-b border-hairline flex items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="press p-2 rounded-lg hover:bg-surface-2 transition-colors"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              <span className="font-medium">AI Health Assistant</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{context.location}</span>
            <span>•</span>
            <span>AQI {context.aqi}</span>
            <span>•</span>
            <span>Risk {context.riskScore}</span>
          </div>
        </div>

        {/* Messages */}
        {puterInitErrorState && (
          <div className="p-4 bg-yellow-50 border-b border-yellow-200 text-sm text-yellow-900 flex items-center justify-between">
            <div>
              <strong>Optional browser AI unavailable:</strong> {puterInitErrorState}. Chat still works through the backend or local AeroHealth assistant; Chrome flags are not required.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  setTryingPuterInit(true);
                  try {
                    const mod = await import('@heyputer/puter.js');
                    // normalize default export
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    const m = mod.default ?? mod;
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    window.puter = typeof m === 'function' ? m() : m;
                    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                    // @ts-ignore
                    window.puterInitError = undefined;
                    setPuterInitErrorState(null);
                  } catch (err) {
                    console.error('Dynamic Puter import failed', err);
                    setPuterInitErrorState(String(err ?? 'Import failed'));
                  } finally {
                    setTryingPuterInit(false);
                  }
                }}
                disabled={tryingPuterInit}
                className="press px-3 py-1 rounded border bg-yellow-100 text-yellow-900 hover:bg-yellow-200"
              >
                {tryingPuterInit ? 'Trying...' : 'Retry Init'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className="press px-3 py-1 rounded border bg-surface-2 text-sm"
              >
                Refresh
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <AnimatePresence>
              {messages.map((message, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className={`flex gap-4 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
                >
                  {/* Avatar */}
                  <div className={`flex-shrink-0 size-8 rounded-full flex items-center justify-center ${
                    message.role === 'user' 
                      ? 'bg-primary/20 text-primary' 
                      : 'bg-surface-3 border border-hairline'
                  }`}>
                    {message.role === 'user' ? (
                      <span className="text-xs font-bold">You</span>
                    ) : (
                      <Sparkles size={14} className="text-primary" />
                    )}
                  </div>

                  {/* Message content */}
                  <div className="flex-1 space-y-2">
                    <div className={`rounded-2xl px-4 py-3 ${
                      message.role === 'user'
                        ? 'bg-primary/10 border border-primary/20 ml-12'
                        : 'bg-surface-2 border border-hairline mr-12'
                    }`}>
                      <div className="text-sm whitespace-pre-wrap leading-relaxed">
                        {message.content}
                      </div>
                      
                      {message.imageUrl && (
                        <img 
                          src={message.imageUrl} 
                          alt="Generated visualization"
                          className="mt-3 rounded-lg border border-hairline max-w-full"
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-2 px-1">
                      <span className="text-[10px] text-muted-foreground num">
                        {message.timestamp.toLocaleTimeString()}
                      </span>
                      
                      {message.role === 'assistant' && (
                        <button
                          onClick={() => speakMessage(message.content)}
                          disabled={speaking}
                          className="press p-1 rounded hover:bg-surface-3 transition-colors opacity-0 group-hover:opacity-100"
                          title="Speak"
                        >
                          <Volume2 size={12} className={speaking ? 'text-primary animate-pulse' : 'text-muted-foreground'} />
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Streaming message */}
            {streaming && currentStream && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-4"
              >
                <div className="flex-shrink-0 size-8 rounded-full flex items-center justify-center bg-surface-3 border border-hairline">
                  <Sparkles size={14} className="text-primary animate-pulse" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="rounded-2xl px-4 py-3 bg-surface-2 border border-hairline mr-12">
                    <div className="text-sm whitespace-pre-wrap leading-relaxed">{currentStream}</div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Quick prompts (show when chat is empty) */}
            {messages.length <= 1 && !streaming && (
              <div className="grid grid-cols-2 gap-3 max-w-2xl mx-auto mt-8">
                {quickPrompts.map((prompt, i) => (
                  <motion.button
                    key={i}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    onClick={() => sendMessage(prompt.prompt)}
                    className="press flex items-center gap-3 rounded-xl border border-hairline bg-surface-2 px-4 py-3 text-left hover:border-primary/30 hover:bg-surface-3 transition-colors"
                  >
                    <span className="text-primary">{prompt.icon}</span>
                    <span className="text-sm">{prompt.text}</span>
                  </motion.button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="border-t border-hairline p-4 bg-surface-1">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message AI Assistant..."
                  className="w-full resize-none rounded-2xl border border-hairline bg-surface-2 px-4 py-3 pr-12 text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                  rows={1}
                  style={{ maxHeight: '120px', minHeight: '48px' }}
                  disabled={streaming}
                />
              </div>

              <button
                onClick={recording ? stopRecording : startRecording}
                disabled={streaming}
                className={`press flex size-12 items-center justify-center rounded-xl border transition-all ${
                  recording
                    ? 'border-red-500 bg-red-500/20 text-red-500 animate-pulse'
                    : 'border-hairline bg-surface-2 text-muted-foreground hover:border-primary/30 hover:text-primary'
                }`}
                title={recording ? 'Stop recording' : 'Voice input'}
              >
                {recording ? <StopCircle size={18} /> : <Mic size={18} />}
              </button>

              <button
                onClick={() => setShowImageGen(!showImageGen)}
                className="press flex size-12 items-center justify-center rounded-xl border border-hairline bg-surface-2 text-muted-foreground transition-colors hover:border-primary/30 hover:text-primary"
                title="Generate image"
              >
                <ImageIcon size={18} />
              </button>

              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || streaming}
                className="press flex size-12 items-center justify-center rounded-xl border border-primary/35 bg-primary/12 text-primary transition-colors hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {streaming ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </div>

            {/* Image generation prompt */}
            {showImageGen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="mt-2 flex gap-2"
              >
                <input
                  type="text"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && generateImage()}
                  placeholder="Describe the visualization you want..."
                  className="flex-1 rounded-xl border border-hairline bg-surface-2 px-4 py-2 text-sm focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
                />
                <button
                  onClick={generateImage}
                  disabled={!imagePrompt.trim()}
                  className="press px-4 py-2 rounded-xl border border-primary/35 bg-primary/12 text-sm text-primary hover:bg-primary/20 disabled:opacity-40"
                >
                  Generate
                </button>
              </motion.div>
            )}

            <div className="mt-2 text-[10px] text-muted-foreground text-center">
              Press Enter to send, Shift+Enter for new line
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
