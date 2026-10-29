import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import {
  ArrowUp, Check, ChevronDown, CircleHelp, Clock3, Code2, Copy, FileText,
  Lightbulb, LogOut, Menu, MessageSquare, PanelLeftClose, Pencil, Plus, Search, Trash2, X,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { BACKEND_URL } from '../backend-config'
import { useAuth } from '../auth/useAuth'
import MessageContent from '../components/MessageContent'
import OpenAILogo from '../components/OpenAILogo'

const suggestions = [
  { icon: Code2, text: 'Explain this error' },
  { icon: FileText, text: 'Review a piece of writing' },
  { icon: Lightbulb, text: 'Help me plan a project' },
  { icon: Code2, text: 'Work through a coding question' },
]

function getTitle(prompt) {
  const line = prompt.trim().split('\n')[0]
  return line.length > 54 ? `${line.slice(0, 51).trimEnd()}...` : line
}

function formatTime(value) {
  if (value === null || value === undefined || value === '') return ''
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return {
    label: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date),
    dateTime: date.toISOString(),
  }
}

function initials(user) {
  const fullName = user?.fullName || {}
  return `${fullName.firstName?.[0] || user?.email?.[0] || 'U'}${fullName.lastName?.[0] || ''}`.toUpperCase()
}

function MessageRow({ message }) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const messageTime = formatTime(message.createdAt)

  async function copyResponse() {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <article className={`message-row ${isUser ? 'message-user' : 'message-assistant'}`}>
      <div className={`message-avatar ${isUser ? 'user-avatar' : 'ai-avatar'}`}>
        {isUser ? <span>{message.initials || 'U'}</span> : <OpenAILogo size={15} />}
      </div>
      <div className="message-content-wrap">
        <div className="message-meta">
          <strong>{isUser ? 'You' : 'GPT Clone'}</strong>
          {messageTime && <time dateTime={messageTime.dateTime}>{messageTime.label}</time>}
        </div>
        <div className="message-body">
          {isUser ? <div className="user-message-content">{message.content}</div> : <MessageContent content={message.content} />}
          {!isUser && <button className="copy-response" type="button" onClick={copyResponse} aria-label="Copy response">
            {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy'}
          </button>}
        </div>
      </div>
    </article>
  )
}

function TypingIndicator() {
  return (
    <article className="message-row message-assistant typing-row" role="status" aria-label="Thinking through it">
      <div className="message-avatar ai-avatar"><OpenAILogo size={15} /></div>
      <div className="typing-bubble" aria-hidden="true"><span /><span /><span /><em>Thinking through it</em></div>
    </article>
  )
}

export default function ChatPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [socketState, setSocketState] = useState('connecting')
  const [socketError, setSocketError] = useState('')
  const [socketRetry, setSocketRetry] = useState(0)
  const socketRef = useRef(null)
  const [chats, setChats] = useState([])
  const [chatListLoading, setChatListLoading] = useState(true)
  const [chatListError, setChatListError] = useState('')
  const [activeChatId, setActiveChatId] = useState(null)
  const [messagesByChat, setMessagesByChat] = useState({})
  const [messagesLoadErrors, setMessagesLoadErrors] = useState({})
  const [messagesLoadRetry, setMessagesLoadRetry] = useState(0)
  const [input, setInput] = useState('')
  const [pendingChatId, setPendingChatId] = useState(null)
  const [messageErrors, setMessageErrors] = useState({})
  const [draftError, setDraftError] = useState(null)
  const [search, setSearch] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [renamingChatId, setRenamingChatId] = useState(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [chatActionError, setChatActionError] = useState('')
  const [chatActionPending, setChatActionPending] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const endRef = useRef(null)
  const newChatButtonRef = useRef(null)
  const deleteDialogRef = useRef(null)
  const deleteCancelRef = useRef(null)
  const deleteTriggerRef = useRef(null)
  const deleteSubmissionRef = useRef(false)
  const inFlightRef = useRef(null)
  const submissionLockRef = useRef(false)
  const timeoutRef = useRef(null)

  const cancelDeleteChat = useCallback(() => {
    if (deleteTarget && chatActionPending === deleteTarget._id) return
    setDeleteTarget(null)
    setDeleteError('')
  }, [chatActionPending, deleteTarget])

  const refreshChats = useCallback(async () => {
    if (!user?._id) return
    try {
      const result = await api.getChats()
      setChats(Array.isArray(result.chats) ? result.chats : [])
      setChatListError('')
    } catch (error) {
      setChatListError(error.message || 'Could not load your conversations.')
      if (error.status === 401) {
        signOut()
        navigate('/login', { replace: true })
      }
    } finally {
      setChatListLoading(false)
    }
  }, [navigate, signOut, user?._id])

  useEffect(() => {
    let current = true
    Promise.resolve().then(() => {
      if (current) refreshChats()
    })
    return () => { current = false }
  }, [user?._id, refreshChats])

  useEffect(() => {
    if (!activeChatId || Object.hasOwn(messagesByChat, activeChatId)) return
    let current = true
    api.getChatMessages(activeChatId)
      .then((result) => {
        if (!current) return
        const messages = (Array.isArray(result.messages) ? result.messages : []).map((message) => ({
          id: message._id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
        }))
        setMessagesByChat((existing) => ({ ...existing, [activeChatId]: messages }))
      })
      .catch((error) => {
        if (!current) return
        setMessagesLoadErrors((errors) => ({ ...errors, [activeChatId]: error.message || 'Could not load this conversation.' }))
        if (error.status === 404) {
          setChats((existing) => existing.filter((chat) => chat._id !== activeChatId))
          setActiveChatId(null)
        }
        if (error.status === 401) {
          signOut()
          navigate('/login', { replace: true })
        }
      })
    return () => { current = false }
  }, [activeChatId, messagesByChat, messagesLoadRetry, navigate, signOut])

  useEffect(() => {
    const client = io(BACKEND_URL || window.location.origin, {
      path: '/socket.io',
      autoConnect: false,
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
    })
    socketRef.current = client

    const onConnect = () => {
      setSocketState('connected')
      setSocketError('')
    }
    const failInFlightRequest = (text) => {
      const request = inFlightRef.current
      if (!request) return
      setMessageErrors((current) => ({
        ...current,
        [request.chatId]: { text, safeRetry: false },
      }))
      inFlightRef.current = null
      submissionLockRef.current = false
      window.clearTimeout(timeoutRef.current)
      setPendingChatId(null)
    }
    const onDisconnect = () => {
      setSocketState('reconnecting')
      failInFlightRequest('The chat connection was interrupted before a response arrived. Check this chat before sending again.')
    }
    const onConnectError = (error) => {
      setSocketState('disconnected')
      setSocketError(/authentication|required|invalid token/i.test(error.message)
        ? 'Your session could not be verified. Sign in again to continue.'
        : 'Could not reach the chat service. Check that the backend is running.')
      failInFlightRequest('The chat connection was interrupted before a response arrived. Check this chat before sending again.')
    }
    const onResponse = (payload = {}) => {
      const request = inFlightRef.current
      if (!request || payload?.chat !== request.chatId || typeof payload?.content !== 'string') return
      setMessagesByChat((current) => ({
        ...current,
        [request.chatId]: [...(current[request.chatId] || []), {
          id: `assistant-${Date.now()}`,
          role: 'model',
          content: payload.content,
          createdAt: new Date(),
        }],
      }))
      setMessageErrors((current) => ({ ...current, [request.chatId]: null }))
      inFlightRef.current = null
      submissionLockRef.current = false
      window.clearTimeout(timeoutRef.current)
      setPendingChatId(null)
      refreshChats()
    }
    const onError = (payload = {}) => {
      const request = inFlightRef.current
      if (!request || (payload?.chat && payload.chat !== request.chatId)) return
      failInFlightRequest(typeof payload?.message === 'string' ? payload.message : 'The message could not be processed.')
    }

    client.on('connect', onConnect)
    client.on('disconnect', onDisconnect)
    client.on('connect_error', onConnectError)
    client.on('ai-response', onResponse)
    client.on('ai-error', onError)
    client.connect()

    return () => {
      client.off('connect', onConnect)
      client.off('disconnect', onDisconnect)
      client.off('connect_error', onConnectError)
      client.off('ai-response', onResponse)
      client.off('ai-error', onError)
      client.disconnect()
      socketRef.current = null
      submissionLockRef.current = false
      inFlightRef.current = null
      window.clearTimeout(timeoutRef.current)
    }
  }, [socketRetry, refreshChats])

  const filteredChats = useMemo(() => chats.filter((chat) =>
    chat.title.toLowerCase().includes(search.trim().toLowerCase())), [chats, search])
  const activeMessages = activeChatId ? messagesByChat[activeChatId] || [] : []
  const activeChat = chats.find((chat) => chat._id === activeChatId)
  const activeError = activeChatId ? messageErrors[activeChatId] : draftError
  const isPending = pendingChatId !== null

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [activeMessages.length, pendingChatId, activeChatId])

  useEffect(() => {
    if (deleteTarget) {
      deleteCancelRef.current?.focus()
      return
    }
    if (deleteTriggerRef.current?.isConnected) deleteTriggerRef.current.focus()
    else newChatButtonRef.current?.focus()
  }, [deleteTarget])

  useEffect(() => {
    if (!deleteTarget) return undefined
    function handleDialogKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (chatActionPending !== deleteTarget._id) cancelDeleteChat()
        return
      }
      if (event.key !== 'Tab') return
      const controls = deleteDialogRef.current?.querySelectorAll('button:not(:disabled)')
      if (!controls?.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleDialogKeyDown)
    return () => document.removeEventListener('keydown', handleDialogKeyDown)
  }, [cancelDeleteChat, deleteTarget, chatActionPending])

  function startNewChat() {
    setActiveChatId(null)
    setInput('')
    setDraftError(null)
    setSidebarOpen(false)
  }

  function selectChat(chatId) {
    setActiveChatId(chatId)
    setSearch('')
    setInput('')
    setDraftError(null)
    setSidebarOpen(false)
  }

  function beginRename(chat) {
    setChatActionError('')
    setRenamingChatId(chat._id)
    setRenameTitle(chat.title)
  }

  function cancelRename() {
    setRenamingChatId(null)
    setRenameTitle('')
    setChatActionError('')
  }

  async function saveRename(event, chat) {
    event.preventDefault()
    const title = renameTitle.trim()
    if (!title) {
      setChatActionError('Chat title cannot be empty.')
      return
    }
    if (title.length > 120) {
      setChatActionError('Chat title must be 120 characters or fewer.')
      return
    }

    setChatActionError('')
    setChatActionPending(chat._id)
    try {
      const result = await api.renameChat(chat._id, title)
      setChats((current) => current.map((item) => item._id === chat._id
        ? { ...item, title: result.chat.title }
        : item))
      await refreshChats()
      cancelRename()
    } catch (error) {
      setChatActionError(error.message || 'Could not rename this chat.')
    } finally {
      setChatActionPending(null)
    }
  }

  function requestDeleteChat(chat, event) {
    if (pendingChatId === chat._id) {
      setChatActionError('Wait for the current response before deleting this chat.')
      return
    }
    setChatActionError('')
    setDeleteError('')
    deleteTriggerRef.current = event.currentTarget
    setDeleteTarget(chat)
  }

  async function confirmDeleteChat() {
    const chat = deleteTarget
    if (!chat || deleteSubmissionRef.current) return
    if (pendingChatId === chat._id) {
      setDeleteError('Wait for the current response before deleting this chat.')
      return
    }

    setDeleteError('')
    deleteSubmissionRef.current = true
    setChatActionPending(chat._id)
    try {
      await api.deleteChat(chat._id)
      setChats((current) => current.filter((item) => item._id !== chat._id))
      setMessagesByChat((current) => {
        const next = { ...current }
        delete next[chat._id]
        return next
      })
      setMessageErrors((current) => {
        const next = { ...current }
        delete next[chat._id]
        return next
      })
      if (activeChatId === chat._id) startNewChat()
      await refreshChats()
      setDeleteTarget(null)
    } catch (error) {
      setDeleteError(error.message || 'Could not delete this chat. Please try again.')
    } finally {
      deleteSubmissionRef.current = false
      setChatActionPending(null)
    }
  }

  async function sendMessage(rawText = input) {
    const content = rawText.trim()
    if (!content || isPending || submissionLockRef.current) return
    const currentSocket = socketRef.current
    if (!currentSocket?.connected) {
      const error = { text: 'The chat service is disconnected. Reconnect before sending.', safeRetry: true }
      if (activeChatId) setMessageErrors((current) => ({ ...current, [activeChatId]: error }))
      else setDraftError(error)
      return
    }

    setDraftError(null)
    submissionLockRef.current = true
    setPendingChatId('creating')
    if (activeChatId) setMessageErrors((current) => ({ ...current, [activeChatId]: null }))
    setInput('')
    let chatId = activeChatId

    try {
      if (!chatId) {
        const result = await api.createChat(getTitle(content))
        const newChat = result.chat
        chatId = newChat._id
        setChats((current) => [newChat, ...current.filter((chat) => chat._id !== newChat._id)])
        setActiveChatId(chatId)
        await refreshChats()
      }

      if (!currentSocket.connected) {
        const error = { text: 'The chat disconnected before your message was sent. Retry when it reconnects.', safeRetry: true }
        setMessageErrors((current) => ({ ...current, [chatId]: error }))
        setInput(content)
        submissionLockRef.current = false
        setPendingChatId(null)
        return
      }

      const userMessage = {
        id: `user-${Date.now()}`,
        role: 'user',
        content,
        initials: initials(user),
        createdAt: new Date(),
      }
      setMessagesByChat((current) => ({
        ...current,
        [chatId]: [...(current[chatId] || []), userMessage],
      }))
      setMessageErrors((current) => ({ ...current, [chatId]: null }))
      inFlightRef.current = { chatId }
      setPendingChatId(chatId)
      currentSocket.emit('ai-message', { chat: chatId, content })

      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = window.setTimeout(() => {
        if (inFlightRef.current?.chatId !== chatId) return
        setMessageErrors((current) => ({
          ...current,
          [chatId]: {
            text: 'No response arrived. Your message may already be saved, so check this chat before sending it again.',
            safeRetry: false,
          },
        }))
        inFlightRef.current = null
        submissionLockRef.current = false
        setPendingChatId(null)
      }, 90000)
    } catch (error) {
      submissionLockRef.current = false
      setPendingChatId(null)
      inFlightRef.current = null
      setInput(content)
      if (activeChatId) {
        setMessageErrors((current) => ({
          ...current,
          [activeChatId]: { text: error.message || 'Could not send your message.', safeRetry: true },
        }))
      } else {
        setDraftError({ text: error.message || 'Could not start a conversation.', safeRetry: true })
      }
    }
  }

  async function handleSignOut() {
    try {
      await api.logout()
      sessionStorage.removeItem('gpt-clone-auth-notice')
    } catch (error) {
      sessionStorage.setItem('gpt-clone-auth-notice', `Signed out of this browser, but server logout could not be confirmed: ${error.message}`)
    } finally {
      setChats([])
      setMessagesByChat({})
      setMessageErrors({})
      setMessagesLoadErrors({})
      setActiveChatId(null)
      signOut()
      navigate('/login', { replace: true })
    }
  }

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        startNewChat()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function handleComposerKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  }

  const connectionLabel = socketState === 'connected'
    ? 'Connected'
    : socketState === 'connecting' ? 'Connecting' : 'Reconnecting'

  return (
    <div className={`chat-app ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {sidebarOpen && <button className="drawer-backdrop" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? 'drawer-open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-top">
          <a className="brand-lockup sidebar-brand" href="/" onClick={(event) => { event.preventDefault(); startNewChat() }}>
            <span className="brand-mark"><OpenAILogo size={17} /></span>
            {!sidebarCollapsed && <span className="brand-name">gpt<span>clone</span></span>}
          </a>
          <button className="icon-button sidebar-collapse" title="Collapse sidebar" onClick={() => setSidebarCollapsed((value) => !value)}>
            <PanelLeftClose size={18} />
          </button>
          <button className="icon-button mobile-close" title="Close sidebar" onClick={() => setSidebarOpen(false)}><X size={19} /></button>
        </div>

        <button ref={newChatButtonRef} className="new-chat-button" onClick={startNewChat} title="New chat">
          <Plus size={17} /><span>New chat</span><kbd>Ctrl K</kbd>
        </button>

        {!sidebarCollapsed && <div className="sidebar-search">
          <Search size={15} />
          <input aria-label="Find a chat by title" placeholder="Find a chat" value={search} onChange={(event) => setSearch(event.target.value)} />
          {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
        </div>}

        {!sidebarCollapsed && <div className="chat-list-area">
          <div className="sidebar-section-title"><span>RECENT</span><span>{chats.length ? chats.length : ''}</span></div>
          {chatActionError && <p className="chat-action-error" role="alert">{chatActionError}</p>}
          {chatListError && <p className="chat-action-error" role="alert">{chatListError}</p>}
          {chatListLoading ? <div className="history-empty" role="status"><p>Loading conversations…</p></div>
            : filteredChats.length ? <div className="chat-list">
            {filteredChats.map((chat) => (
              <div key={chat._id} className={`chat-list-item ${chat._id === activeChatId ? 'selected' : ''}`}>
                {renamingChatId === chat._id ? <form className="chat-rename-form" onSubmit={(event) => saveRename(event, chat)}>
                  <input autoFocus aria-label="Chat title" maxLength={120} value={renameTitle} onChange={(event) => setRenameTitle(event.target.value)} />
                  <button type="submit" aria-label="Save chat title" title="Save" disabled={chatActionPending === chat._id}><Check size={14} /></button>
                  <button type="button" aria-label="Cancel rename" title="Cancel" onClick={cancelRename} disabled={chatActionPending === chat._id}><X size={14} /></button>
                </form> : <>
                  <button type="button" className="chat-list-select" onClick={() => selectChat(chat._id)} title={chat.title}>
                    <MessageSquare size={16} />
                    <span>{chat.title}</span>
                    {chat._id === activeChatId && <span className="active-chat-dot" />}
                  </button>
                  <div className="chat-row-actions">
                    <button type="button" aria-label={`Rename ${chat.title}`} title="Rename chat" onClick={() => beginRename(chat)} disabled={chatActionPending !== null || pendingChatId === chat._id}><Pencil size={13} /></button>
                    <button type="button" aria-label={`Delete ${chat.title}`} title="Delete chat" onClick={(event) => requestDeleteChat(chat, event)} disabled={chatActionPending !== null || pendingChatId === chat._id}><Trash2 size={13} /></button>
                  </div>
                </>}
              </div>
            ))}
          </div> : <div className="history-empty">
            <div className="history-empty-icon"><Clock3 size={16} /></div>
            <p>{search ? 'No matching chats.' : chatListError ? 'Your conversations could not be loaded.' : 'No conversations yet.'}</p>
            {!search && !chatListError && <small>Your saved conversations will appear here.</small>}
            {chatListError && <button type="button" className="history-retry" onClick={refreshChats}>Try again</button>}
          </div>}
        </div>}

        <div className="sidebar-spacer" />
        <div className={`account-area ${accountOpen ? 'account-open' : ''}`}>
          {accountOpen && !sidebarCollapsed && <div className="account-menu">
            <div className="account-menu-user"><div className="user-avatar small-avatar">{initials(user)}</div><div><strong>{user?.fullName?.firstName} {user?.fullName?.lastName}</strong><span>{user?.email}</span></div></div>
            <div className="account-divider" />
            <button className="signout-button" onClick={handleSignOut}><LogOut size={16} /> Sign out</button>
            <p className="logout-limitation">Sign out of this account on this device.</p>
          </div>}
          <button className="account-button" onClick={() => setAccountOpen((open) => !open)} title="Account menu">
            <div className="user-avatar">{initials(user)}</div>
            {!sidebarCollapsed && <><span className="account-name"><strong>{user?.fullName?.firstName} {user?.fullName?.lastName}</strong><small>{user?.email}</small></span><ChevronDown size={15} className="account-chevron" /></>}
          </button>
        </div>
      </aside>

      <main className="chat-main">
        <header className="chat-header">
          <div className="header-left">
            <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><Menu size={19} /></button>
            <button className="icon-button desktop-menu" aria-label="Toggle sidebar" onClick={() => setSidebarCollapsed((value) => !value)}><PanelLeftClose size={18} /></button>
            <span className="header-divider" />
            <div className="conversation-title"><span className="conversation-heading">GPT Clone</span><span className="conversation-subtitle">AI Assistant</span></div>
          </div>
          <div className={`connection-pill ${socketState}`} title={socketError || 'Socket.IO connection status'}>
            <span className="connection-dot" />
            <span>{connectionLabel}</span>
            {socketState === 'disconnected' && <button type="button" onClick={() => { setSocketState('connecting'); setSocketRetry((value) => value + 1) }}>Retry</button>}
          </div>
        </header>

        {socketError && <div className="connection-banner" role="status"><CircleHelp size={16} /><span>{socketError}</span></div>}

        <section className={`conversation ${activeMessages.length ? 'has-messages' : 'is-empty'}`}>
          {activeChatId && !Object.hasOwn(messagesByChat, activeChatId) && !messagesLoadErrors[activeChatId] ? <div className="history-empty message-history-status" role="status"><span className="send-spinner" /><p>Loading conversation…</p></div>
            : activeChatId && messagesLoadErrors[activeChatId] ? <div className="history-empty message-history-status" role="alert"><p>{messagesLoadErrors[activeChatId]}</p><button type="button" className="history-retry" onClick={() => { setMessagesLoadErrors((errors) => ({ ...errors, [activeChatId]: '' })); setMessagesLoadRetry((count) => count + 1) }}>Try again</button></div>
              : activeMessages.length === 0 ? <div className="welcome-screen">
            <span className="eyebrow">GPT CLONE <span className="eyebrow-slash">/</span> READY</span>
            <h1>Start a conversation</h1>
            <p className="welcome-subtitle">Ask a question, paste an error, or bring a draft to work on.</p>
            <div className="suggestion-list">
              {suggestions.map(({ icon: Icon, text }) => (
                <button key={text} className="suggestion-item" onClick={() => setInput(text)}>
                  <Icon size={15} /><span>{text}</span><ArrowUp size={13} className="suggestion-arrow" />
                </button>
              ))}
            </div>
            {pendingChatId === 'creating' && <div className="creating-chat-status"><span className="send-spinner" /> Creating conversation…</div>}
          </div> : <div className="message-list">
            {activeMessages.map((message) => <MessageRow key={message.id} message={message} />)}
            {pendingChatId === activeChatId && <TypingIndicator />}
            <div ref={endRef} />
          </div>}

          {activeError && <div className={`message-error ${activeError.safeRetry ? 'retryable' : ''}`} role="alert">
            <div><CircleHelp size={16} /><span>{activeError.text}</span></div>
            {activeError.safeRetry && <button type="button" onClick={() => sendMessage(input)}>Retry</button>}
          </div>}
        </section>

        <div className="composer-area">
          <form className="composer" onSubmit={(event) => { event.preventDefault(); sendMessage() }}>
            <textarea
              rows={1}
              aria-label="Message GPT Clone"
              placeholder={socketState === 'connected' ? 'Message GPT Clone…' : 'Waiting for the chat service to connect…'}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              onInput={(event) => { event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 180)}px` }}
              disabled={socketState !== 'connected' || isPending}
              maxLength={8000}
            />
            <button className={`send-button ${input.trim() && socketState === 'connected' && !isPending ? 'send-ready' : ''}`} type="submit" aria-label="Send message" disabled={!input.trim() || socketState !== 'connected' || isPending}>
              {isPending ? <span className="send-spinner" /> : <ArrowUp size={18} />}
            </button>
          </form>
          <div className="composer-footer"><span><kbd>Enter</kbd> to send <span className="footer-separator">·</span> <kbd>Shift + Enter</kbd> for a new line</span><span>AI can make mistakes. Check important information.</span></div>
          <div className="mobile-history-note">Your conversations are saved to your account.</div>
        </div>
      </main>
      {deleteTarget && <div className="delete-modal-backdrop">
        <section
          ref={deleteDialogRef}
          className="delete-modal"
          role="dialog"
          aria-modal="true"
          aria-busy={chatActionPending === deleteTarget._id}
          aria-labelledby="delete-modal-title"
          aria-describedby="delete-modal-description"
        >
          <div className="delete-modal-mark"><Trash2 size={17} /></div>
          <h2 id="delete-modal-title">Delete this conversation?</h2>
          <p id="delete-modal-description">
            <span className="delete-chat-title">{deleteTarget.title}</span> and all of its messages and saved memories will be permanently deleted.
          </p>
          {deleteError && <p className="delete-modal-error" role="alert">{deleteError}</p>}
          <div className="delete-modal-actions">
            <button ref={deleteCancelRef} type="button" className="delete-cancel-button" onClick={cancelDeleteChat} disabled={chatActionPending === deleteTarget._id}>Cancel</button>
            <button type="button" className="delete-confirm-button" onClick={confirmDeleteChat} disabled={chatActionPending === deleteTarget._id}>
              {chatActionPending === deleteTarget._id && <span className="delete-spinner" aria-hidden="true" />}
              {chatActionPending === deleteTarget._id ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </section>
      </div>}
    </div>
  )
}
