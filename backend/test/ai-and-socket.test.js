const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")

process.env.OPENROUTER_API_KEY = "test-only-key"
delete process.env.OPENROUTER_MODEL
process.env.OPENROUTER_MAX_RETRIES = "2"
process.env.OPENROUTER_RETRY_BASE_MS = "0"
process.env.OPENROUTER_TIMEOUT_MS = "30"
process.env.GEMINI_MAX_RETRIES = "2"
process.env.GEMINI_RETRY_BASE_MS = "0"

let embedHandler = async () => ({ embeddings: [{ values: [0.1, 0.2] }] })
class MockGoogleGenAI {
  constructor() { this.models = { embedContent: (...args) => embedHandler(...args) } }
}

function stubModule(modulePath, exports) {
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports }
}

stubModule(require.resolve("@google/genai"), { GoogleGenAI: MockGoogleGenAI })
const aiService = require(path.resolve(__dirname, "../src/services/ai.service.js"))

function response(status, body, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
}
function success(content = "response") {
  return response(200, { choices: [{ message: { content } }] })
}
function failure(status, message, headers = {}, metadata) {
  return response(status, { error: { message, metadata } }, headers)
}
const originalFetch = global.fetch
test.afterEach(() => {
  global.fetch = originalFetch
  delete process.env.OPENROUTER_FALLBACK_MODEL
})

test("OpenRouter sends RAG context and chat history using the free router by default", async () => {
  let request
  global.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) }
    return success("remembered response")
  }
  const answer = await aiService.generateResponse([
    { role: "user", parts: [{ text: "LTM: user's remembered fact" }] },
    { role: "model", parts: [{ text: "prior assistant response" }] },
    { role: "user", parts: [{ text: "current question" }] },
  ])
  assert.equal(answer, "remembered response")
  assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions")
  assert.equal(request.body.model, "openrouter/free")
  assert.deepEqual(request.body.messages, [
    {
      role: "system",
      content: `You are GPT Clone, an AI assistant created by Nitin Kapil. Only when a user asks about your identity (for example, "Who are you?", "What are you?", or asks you to introduce yourself), respond exactly: "I'm GPT Clone, created by Nitin Kapil. How can I help you today?" For all other requests, answer directly and naturally without introducing yourself or repeating this identity statement.`,
    },
    { role: "user", content: "LTM: user's remembered fact" },
    { role: "assistant", content: "prior assistant response" },
    { role: "user", content: "current question" },
  ])
  assert.equal(request.options.headers.Authorization, "Bearer test-only-key")
})

test("temporary OpenRouter 503 failures retry with a bounded attempt count", async () => {
  let calls = 0
  global.fetch = async () => ++calls < 3 ? failure(503, "upstream unavailable") : success("recovered")
  assert.equal(await aiService.generateResponse([{ role: "user", content: "hello" }]), "recovered")
  assert.equal(calls, 3)
})

test("OpenRouter rejects missing choices, missing content, and empty content with safe errors", async () => {
  const invalidBodies = [
    [{}, "OPENROUTER_MISSING_CHOICES"],
    [{ choices: [] }, "OPENROUTER_MISSING_CHOICES"],
    [{ choices: [{ message: {} }] }, "OPENROUTER_EMPTY_RESPONSE"],
    [{ choices: [{ message: { content: "   " } }] }, "OPENROUTER_EMPTY_RESPONSE"],
  ]
  for (const [body, code] of invalidBodies) {
    let calls = 0
    global.fetch = async () => { calls += 1; return response(200, body) }
    await assert.rejects(aiService.generateResponse([{ role: "user", content: "hello" }]), (error) => {
      assert.equal(error.code, code)
      return true
    })
    assert.equal(calls, 1)
  }
})

test("OpenRouter extracts text-block content and uses a configured fallback only after an unusable response", async () => {
  global.fetch = async () => response(200, { choices: [{ message: { content: [{ type: "text", text: "array response" }] } }] })
  assert.equal(await aiService.generateResponse([{ role: "user", content: "hello" }]), "array response")

  process.env.OPENROUTER_FALLBACK_MODEL = "test/fallback-free"
  const models = []
  global.fetch = async (_url, options) => {
    const model = JSON.parse(options.body).model
    models.push(model)
    return model === "openrouter/free" ? response(200, { choices: [] }) : success("fallback answer")
  }
  assert.equal(await aiService.generateResponse([{ role: "user", content: "hello" }]), "fallback answer")
  assert.deepEqual(models, ["openrouter/free", "test/fallback-free"])
})

test("OpenRouter provider errors in a successful HTTP envelope are classified without exposing their text", async () => {
  global.fetch = async () => response(200, { error: { code: "model_not_found", message: "provider detail must stay private" } })
  await assert.rejects(aiService.generateResponse([{ role: "user", content: "hello" }]), (error) => {
    assert.equal(error.code, "OPENROUTER_MODEL_UNAVAILABLE")
    assert.equal(error.status, 404)
    assert.doesNotMatch(error.message, /provider detail/)
    return true
  })
})

test("temporary 429 rate limits retry, while daily quota limits do not", async () => {
  let calls = 0
  global.fetch = async () => ++calls === 1
    ? failure(429, "Rate limit exceeded", { "retry-after": "0" }, { error_type: "rate_limit_exceeded" })
    : success("recovered")
  assert.equal(await aiService.generateResponse([{ role: "user", content: "hello" }]), "recovered")
  assert.equal(calls, 2)

  calls = 0
  global.fetch = async () => { calls += 1; return failure(429, "Free model daily limit reached") }
  await assert.rejects(aiService.generateResponse([{ role: "user", content: "hello" }]), (error) => {
    assert.equal(error.code, "OPENROUTER_QUOTA_EXCEEDED")
    return true
  })
  assert.equal(calls, 1)
})

test("permanent authentication and model configuration errors are not retried", async () => {
  for (const [status, code] of [[401, "OPENROUTER_AUTHENTICATION_FAILED"], [404, "OPENROUTER_MODEL_UNAVAILABLE"]]) {
    let calls = 0
    global.fetch = async () => { calls += 1; return failure(status, "provider failure") }
    await assert.rejects(aiService.generateResponse([{ role: "user", content: "hello" }]), (error) => {
      assert.equal(error.code, code)
      return true
    })
    assert.equal(calls, 1)
  }
})

test("timed out OpenRouter requests retry only to the configured maximum", async () => {
  let calls = 0
  global.fetch = (_url, { signal }) => new Promise((resolve, reject) => {
    calls += 1
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
  })
  await assert.rejects(aiService.generateResponse([{ role: "user", content: "hello" }]), (error) => {
    assert.equal(error.code, "OPENROUTER_TIMEOUT")
    return true
  })
  assert.equal(calls, 3)
})

test("Gemini embeddings retain their existing model and output dimensions", async () => {
  let call
  embedHandler = async (request) => { call = request; return { embeddings: [{ values: [0.25, 0.75] }] } }
  assert.deepEqual(await aiService.generateVector("sample"), [0.25, 0.75])
  assert.equal(call.model, "gemini-embedding-2")
  assert.deepEqual(call.config, { outputDimensionality: 768 })
})

const backendPath = path.resolve(__dirname, "../src")
const chatId = "64b000000000000000000001"
const userId = "64b000000000000000000002"
const chatModel = { findOne: async () => ({ _id: chatId }), updateOne: async () => ({ acknowledged: true }) }
const messageModel = {
  create: async (document) => ({ _id: document.role === "user" ? "64b000000000000000000011" : "64b000000000000000000012" }),
  find: () => ({ sort() { return this }, limit() { return this }, async lean() { return [] } }),
}
let createMemoryHandler = async () => {}
const vectorService = { createMemory: (...args) => createMemoryHandler(...args), queryMemory: async () => [] }
class MockSocketIoServer {
  constructor() { this.handlers = {} }
  use(handler) { this.middleware = handler }
  on(event, handler) { this.handlers[event] = handler }
}
stubModule(require.resolve("socket.io"), { Server: MockSocketIoServer })
stubModule(path.join(backendPath, "models/user.model.js"), { findById: async () => ({ _id: userId }) })
stubModule(path.join(backendPath, "models/chat.model.js"), chatModel)
stubModule(path.join(backendPath, "models/message.model.js"), messageModel)
stubModule(path.join(backendPath, "services/ai.service.js"), aiService)
stubModule(path.join(backendPath, "services/vector.service.js"), vectorService)
const initSocketServer = require(path.join(backendPath, "sockets/socket.server.js"))

async function runSocketMessage(payload) {
  const io = initSocketServer({})
  const listeners = {}
  const emitted = []
  const socket = {
    user: { _id: userId },
    on(event, handler) { listeners[event] = handler },
    emit(event, data) { emitted.push({ event, data }) },
  }
  io.handlers.connection(socket)
  await listeners["ai-message"](payload)
  return emitted
}

test("Socket.IO catches MongoDB failures and emits ai-error without rejecting its handler", async () => {
  chatModel.findOne = async () => { throw new Error("database failure") }
  const events = await runSocketMessage({ chat: chatId, content: "safe test input" })
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "ai-error")
  assert.equal(events[0].data.chat, chatId)
  assert.match(events[0].data.message, /could not be processed/i)
})

test("Socket.IO catches Pinecone failures and emits ai-error", async () => {
  chatModel.findOne = async () => ({ _id: chatId })
  createMemoryHandler = async () => { throw new Error("vector store failure") }
  global.fetch = async () => success("should not generate")
  const events = await runSocketMessage({ chat: chatId, content: "safe test input" })
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "ai-error")
  assert.equal(events[0].data.chat, chatId)
})

test("Socket.IO catches exhausted OpenRouter 503s and emits ai-error with the same chat ID", async () => {
  chatModel.findOne = async () => ({ _id: chatId })
  createMemoryHandler = async () => {}
  global.fetch = async () => failure(503, "upstream unavailable")
  const events = await runSocketMessage({ chat: chatId, content: "safe test input" })
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "ai-error")
  assert.equal(events[0].data.chat, chatId)
  assert.match(events[0].data.message, /temporarily unavailable/i)
})

test("Socket.IO never saves or emits an empty provider response", async () => {
  chatModel.findOne = async () => ({ _id: chatId })
  chatModel.updateOne = async () => ({ acknowledged: true })
  createMemoryHandler = async () => {}
  const savedRoles = []
  messageModel.create = async (document) => {
    savedRoles.push(document.role)
    return { _id: document.role === "user" ? "64b000000000000000000011" : "64b000000000000000000012" }
  }
  global.fetch = async () => response(200, { choices: [{ message: { content: "" } }] })

  const events = await runSocketMessage({ chat: chatId, content: "safe test input" })
  assert.deepEqual(savedRoles, ["user"])
  assert.equal(events.length, 1)
  assert.equal(events[0].event, "ai-error")
  assert.equal(events[0].data.code, "OPENROUTER_EMPTY_RESPONSE")
})

test("Socket.IO reports an unauthorized chat without creating messages", async () => {
  chatModel.findOne = async () => null
  let creates = 0
  messageModel.create = async () => { creates += 1 }
  const events = await runSocketMessage({ chat: chatId, content: "safe test input" })
  assert.equal(creates, 0)
  assert.equal(events[0].event, "ai-error")
  assert.equal(events[0].data.code, "CHAT_NOT_FOUND")
})
