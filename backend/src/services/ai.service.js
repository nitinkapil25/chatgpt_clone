const { GoogleGenAI } = require("@google/genai")

// Gemini remains responsible only for embeddings. Text generation is routed
// through OpenRouter's OpenAI-compatible API from this backend module.
const gemini = new GoogleGenAI()
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL?.trim() || "openrouter/free"
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY?.trim()
const EMBEDDING_MODEL = (process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-2").trim()
const SYSTEM_PROMPT = `You are GPT Clone, an AI assistant created by Nitin Kapil. Only when a user asks about your identity (for example, "Who are you?", "What are you?", or asks you to introduce yourself), respond exactly: "I'm GPT Clone, created by Nitin Kapil. How can I help you today?" For all other requests, answer directly and naturally without introducing yourself or repeating this identity statement.`

function boundedInteger(value, fallback, maximum) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, maximum)) : fallback
}

const GEMINI_MAX_RETRIES = boundedInteger(process.env.GEMINI_MAX_RETRIES, 2, 4)
const GEMINI_RETRY_BASE_MS = boundedInteger(process.env.GEMINI_RETRY_BASE_MS, 400, 5000)
const OPENROUTER_MAX_RETRIES = boundedInteger(process.env.OPENROUTER_MAX_RETRIES, 2, 3)
const OPENROUTER_RETRY_BASE_MS = boundedInteger(process.env.OPENROUTER_RETRY_BASE_MS, 500, 5000)
const OPENROUTER_TIMEOUT_MS = boundedInteger(process.env.OPENROUTER_TIMEOUT_MS, 20000, 60000) || 20000

class AiServiceError extends Error {
  constructor(message, { code, status, retryable = false, publicMessage, retryAfterMs }) {
    super(message)
    this.name = "AiServiceError"
    this.code = code
    this.status = status
    this.retryable = retryable
    this.publicMessage = publicMessage
    this.retryAfterMs = retryAfterMs
  }
}

function getStatus(error) {
  const candidates = [error?.status, error?.statusCode, error?.response?.status, error?.code]
  for (const candidate of candidates) {
    const status = Number(candidate)
    if (Number.isInteger(status) && status >= 100 && status <= 599) return status
  }
  const match = `${error?.status || ""} ${error?.code || ""} ${error?.message || ""}`
    .match(/\b(408|500|502|503|504)\b/)
  return match ? Number(match[1]) : undefined
}

function isGeminiRetryable(error) {
  const status = getStatus(error)
  const descriptor = `${error?.code || ""} ${error?.status || ""} ${error?.message || ""}`.toLowerCase()
  if (/quota|resource_exhausted|billing|api key|unauthenticated|permission_denied|invalid_argument/.test(descriptor)) {
    return false
  }
  if ([400, 401, 403, 404, 429].includes(status)) return false
  if ([408, 500, 502, 503, 504].includes(status)) return true
  return /unavailable|deadline_exceeded|econnreset|etimedout|econnrefused|network error|fetch failed/.test(descriptor)
}

function makeGeminiError(error, operation) {
  if (error instanceof AiServiceError) return error
  const status = getStatus(error)
  const descriptor = `${error?.code || ""} ${error?.status || ""} ${error?.message || ""}`.toLowerCase()
  if (/quota|resource_exhausted|billing/.test(descriptor) || status === 429) {
    return new AiServiceError(`${operation} quota is unavailable`, {
      code: "AI_QUOTA_EXCEEDED",
      status,
      publicMessage: "The AI service has reached its current quota. Please try again later.",
    })
  }
  if (/unauthenticated|permission_denied|api key|credential/.test(descriptor) || status === 401 || status === 403) {
    return new AiServiceError(`${operation} credentials were rejected`, {
      code: "AI_AUTHENTICATION_FAILED",
      status,
      publicMessage: "The AI service is not configured correctly. Please contact the administrator.",
    })
  }
  if (isGeminiRetryable(error)) {
    return new AiServiceError(`${operation} service is temporarily unavailable`, {
      code: "AI_TEMPORARILY_UNAVAILABLE",
      status,
      retryable: true,
      publicMessage: "The AI service is temporarily unavailable. Please try again shortly.",
    })
  }
  return new AiServiceError(`${operation} request failed`, {
    code: "AI_REQUEST_FAILED",
    status,
    publicMessage: "The AI service could not process this request. Please try again.",
  })
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function withGeminiRetries(operation, operationName) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      const serviceError = makeGeminiError(error, operationName)
      if (!serviceError.retryable || attempt >= GEMINI_MAX_RETRIES) throw serviceError
      const delay = GEMINI_RETRY_BASE_MS * (2 ** attempt)
      await wait(delay + Math.floor(Math.random() * Math.max(1, delay * 0.25)))
    }
  }
}

function toOpenRouterMessages(contents) {
  if (!Array.isArray(contents)) {
    throw new AiServiceError("Invalid text-generation context", {
      code: "INVALID_AI_CONTEXT",
      publicMessage: "The conversation context is invalid. Please try again.",
    })
  }

  return contents.flatMap((item) => {
    if (!item || !["user", "model", "assistant", "system", "developer"].includes(item.role)) return []
    const role = item.role === "model" ? "assistant" : item.role
    const content = Array.isArray(item.parts)
      ? item.parts.map((part) => typeof part?.text === "string" ? part.text : "").filter(Boolean).join("\n")
      : typeof item.content === "string" ? item.content : ""
    return content ? [{ role, content }] : []
  })
}

function parseRetryAfter(value) {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(seconds * 1000, 10000))
  const dateDelay = Date.parse(value) - Date.now()
  return Number.isFinite(dateDelay) ? Math.max(0, Math.min(dateDelay, 10000)) : undefined
}

function parseRateLimitReset(value) {
  if (!value) return undefined
  const number = Number(value)
  if (Number.isFinite(number)) {
    const timestamp = number > 1e12 ? number : number > 1e9 ? number * 1000 : undefined
    return timestamp === undefined ? Math.max(0, number * 1000) : Math.max(0, timestamp - Date.now())
  }
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined
}

function safeModelId(value) {
  if (typeof value !== "string") return undefined
  const model = value.trim()
  return model && model.length <= 120 && /^[A-Za-z0-9._:/-]+$/.test(model) ? model : undefined
}

function responseStructure(result, modelId) {
  const safeKeys = (value, allowlist) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).filter((key) => allowlist.includes(key))
    : []
  const choice = Array.isArray(result?.choices) ? result.choices[0] : undefined
  const message = choice?.message
  const content = message?.content
  const providerCode = result?.error?.code
  return {
    modelId: safeModelId(modelId),
    returnedModelId: safeModelId(result?.model),
    responseKeys: safeKeys(result, ["id", "object", "created", "model", "provider", "system_fingerprint", "service_tier", "choices", "usage", "error"]),
    choicesType: Array.isArray(result?.choices) ? "array" : typeof result?.choices,
    choiceCount: Array.isArray(result?.choices) ? result.choices.length : undefined,
    choiceKeys: safeKeys(choice, ["index", "finish_reason", "native_finish_reason", "message", "error"]),
    finishReason: typeof choice?.finish_reason === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(choice.finish_reason)
      ? choice.finish_reason
      : undefined,
    messageKeys: safeKeys(message, ["role", "content", "refusal", "reasoning", "reasoning_details", "tool_calls"]),
    contentType: Array.isArray(content) ? "array" : typeof content,
    contentLength: typeof content === "string" ? content.length : undefined,
    providerErrorCode: typeof providerCode === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(providerCode)
      ? providerCode
      : Number.isInteger(providerCode) ? providerCode : undefined,
  }
}

function logOpenRouterDiagnostic(label, fields) {
  const diagnostic = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
  console.warn(label, diagnostic)
}

function extractTextContent(content) {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  const textParts = content
    .filter((part) => part && typeof part === "object" && (part.type === "text" || typeof part.text === "string"))
    .map((part) => typeof part.text === "string" ? part.text : "")
  return textParts.length ? textParts.join("") : undefined
}

function makeOpenRouterHttpError(status, providerMessage, retryAfter, metadata, headers) {
  const description = typeof providerMessage === "string" ? providerMessage.slice(0, 500) : ""
  const normalized = description.toLowerCase()
  const retryAfterMs = parseRetryAfter(retryAfter)

  if (status === 429) {
    const metadataText = JSON.stringify(metadata || {}).toLowerCase()
    const limit = headers?.get("x-ratelimit-limit")?.toLowerCase() || ""
    const reset = headers?.get("x-ratelimit-reset")
    const resetDelay = parseRateLimitReset(reset)
    const likelyDailyLimit = /daily|per day|quota|insufficient credits|credit balance|requests per day|free model limit|daily limit/.test(`${normalized} ${metadataText} ${limit}`)
      || (resetDelay !== undefined && resetDelay >= 60 * 60 * 1000)
    if (likelyDailyLimit) {
      return new AiServiceError("OpenRouter usage quota is unavailable", {
        code: "OPENROUTER_QUOTA_EXCEEDED",
        status,
        publicMessage: "The OpenRouter free-model quota has been reached. Please try again later.",
      })
    }
    return new AiServiceError("OpenRouter rate limit was reached", {
      code: "OPENROUTER_RATE_LIMITED",
      status,
      retryable: true,
      retryAfterMs,
      publicMessage: "The AI service is receiving too many requests. Please try again shortly.",
    })
  }
  if (status === 401 || status === 403) {
    return new AiServiceError("OpenRouter rejected the configured credentials", {
      code: "OPENROUTER_AUTHENTICATION_FAILED",
      status,
      publicMessage: "The OpenRouter API key was rejected. Check the backend configuration.",
    })
  }
  if (status === 402) {
    return new AiServiceError("OpenRouter account requires credits", {
      code: "OPENROUTER_CREDITS_REQUIRED",
      status,
      publicMessage: "The OpenRouter account cannot use the selected model. Check its free-model quota or account balance.",
    })
  }
  if ([400, 404, 413, 422].includes(status)) {
    return new AiServiceError("OpenRouter rejected the model or request configuration", {
      code: status === 404 ? "OPENROUTER_MODEL_UNAVAILABLE" : "OPENROUTER_REQUEST_INVALID",
      status,
      publicMessage: status === 404
        ? "The configured OpenRouter model is unavailable. Check OPENROUTER_MODEL."
        : "OpenRouter rejected the generation request. Check the model configuration and context size.",
    })
  }
  if ([408, 500, 502, 503, 504, 524, 529].includes(status)) {
    return new AiServiceError("OpenRouter or its model provider is temporarily unavailable", {
      code: "OPENROUTER_TEMPORARILY_UNAVAILABLE",
      status,
      retryable: true,
      publicMessage: "The AI service is temporarily unavailable. Please try again shortly.",
    })
  }
  return new AiServiceError("OpenRouter generation request failed", {
    code: "OPENROUTER_REQUEST_FAILED",
    status,
    publicMessage: "The AI service could not process this request. Please try again.",
  })
}

async function requestOpenRouter(messages, modelId = OPENROUTER_MODEL) {
  if (!OPENROUTER_API_KEY) {
    throw new AiServiceError("OPENROUTER_API_KEY is not configured", {
      code: "OPENROUTER_NOT_CONFIGURED",
      publicMessage: "Text generation is not configured. Set OPENROUTER_API_KEY in the backend environment.",
    })
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS)
  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: modelId, messages }),
      signal: controller.signal,
    })

    const result = await response.json().catch(() => null)
    if (!response.ok) {
      const error = makeOpenRouterHttpError(
        response.status,
        result?.error?.message,
        response.headers.get("retry-after"),
        result?.error?.metadata,
        response.headers,
      )
      logOpenRouterDiagnostic("OpenRouter request failed", {
        httpStatus: response.status,
        errorCode: error.code,
        ...responseStructure(result, modelId),
      })
      throw error
    }

    if (result?.error) {
      const providerStatus = Number(result.error.code)
      const providerDescriptor = `${result.error.code || ""} ${result.error.message || ""}`.toLowerCase()
      const embeddedStatus = providerDescriptor.match(/\b(4\d\d|5\d\d)\b/)
      const inferredStatus = /model[_ -](?:not[_ -]found|unavailable)|no[_ -]such[_ -]model/.test(providerDescriptor)
        ? 404
        : embeddedStatus ? Number(embeddedStatus[1]) : undefined
      const status = Number.isInteger(providerStatus) && providerStatus >= 400 && providerStatus <= 599
        ? providerStatus
        : inferredStatus || (response.status >= 400 ? response.status : 502)
      const error = makeOpenRouterHttpError(status, result.error.message, undefined, result.error.metadata, response.headers)
      logOpenRouterDiagnostic("OpenRouter returned a provider error", {
        httpStatus: response.status,
        errorCode: error.code,
        ...responseStructure(result, modelId),
      })
      throw error
    }

    if (!Array.isArray(result?.choices) || result.choices.length === 0) {
      const error = new AiServiceError("OpenRouter returned no completion choices", {
        code: "OPENROUTER_MISSING_CHOICES",
        publicMessage: "The AI service did not return a usable response. Please try again.",
      })
      logOpenRouterDiagnostic("OpenRouter response was unusable", {
        httpStatus: response.status,
        errorCode: error.code,
        ...responseStructure(result, modelId),
      })
      throw error
    }

    const firstChoice = result.choices[0]
    const text = extractTextContent(firstChoice?.message?.content)
    if (!text?.trim()) {
      const error = new AiServiceError("OpenRouter returned no assistant text content", {
        code: firstChoice?.message ? "OPENROUTER_EMPTY_RESPONSE" : "OPENROUTER_MALFORMED_RESPONSE",
        publicMessage: "The AI service did not return a usable response. Please try again.",
      })
      logOpenRouterDiagnostic("OpenRouter response was unusable", {
        httpStatus: response.status,
        errorCode: error.code,
        ...responseStructure(result, modelId),
      })
      throw error
    }
    return text
  } catch (error) {
    if (error instanceof AiServiceError) throw error
    if (controller.signal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new AiServiceError("OpenRouter generation request timed out", {
        code: "OPENROUTER_TIMEOUT",
        status: 408,
        retryable: true,
        publicMessage: "The AI service took too long to respond. Please try again.",
      })
    }
    throw new AiServiceError("OpenRouter network request failed", {
      code: "OPENROUTER_NETWORK_ERROR",
      retryable: true,
      publicMessage: "Could not reach the AI service. Please try again shortly.",
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function requestWithOpenRouterRetries(messages, modelId) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await requestOpenRouter(messages, modelId)
    } catch (error) {
      const serviceError = error instanceof AiServiceError ? error : new AiServiceError("OpenRouter request failed", {
        code: "OPENROUTER_REQUEST_FAILED",
        publicMessage: "The AI service could not process this request. Please try again.",
      })
      if (!serviceError.retryable || attempt >= OPENROUTER_MAX_RETRIES) throw serviceError
      const delay = OPENROUTER_RETRY_BASE_MS * (2 ** attempt)
      const exponentialDelay = delay + Math.floor(Math.random() * Math.max(1, delay * 0.25))
      await wait(Math.max(exponentialDelay, serviceError.retryAfterMs || 0))
    }
  }
}

async function generateResponse(contents) {
  const conversationMessages = toOpenRouterMessages(contents)
  if (conversationMessages.length === 0) {
    throw new AiServiceError("No text messages were provided for generation", {
      code: "INVALID_AI_CONTEXT",
      publicMessage: "The conversation context is empty. Please try again.",
    })
  }
  const messages = [{ role: "system", content: SYSTEM_PROMPT }, ...conversationMessages]

  try {
    return await requestWithOpenRouterRetries(messages, OPENROUTER_MODEL)
  } catch (error) {
    const fallbackModel = safeModelId(process.env.OPENROUTER_FALLBACK_MODEL)
    const eligibleForFallback = [
      "OPENROUTER_MODEL_UNAVAILABLE",
      "OPENROUTER_MISSING_CHOICES",
      "OPENROUTER_MALFORMED_RESPONSE",
      "OPENROUTER_EMPTY_RESPONSE",
      "OPENROUTER_TEMPORARILY_UNAVAILABLE",
    ].includes(error?.code)
    if (!fallbackModel || fallbackModel === OPENROUTER_MODEL || !eligibleForFallback) throw error

    logOpenRouterDiagnostic("Trying configured OpenRouter fallback model", {
      errorCode: error.code,
      modelId: OPENROUTER_MODEL,
      fallbackModelId: fallbackModel,
    })
    return requestWithOpenRouterRetries(messages, fallbackModel)
  }
}

async function generateVector(content) {
  const response = await withGeminiRetries(() => gemini.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: content,
    config: { outputDimensionality: 768 },
  }), "AI embedding")

  const vector = response?.embeddings?.[0]?.values
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new AiServiceError("AI returned an empty embedding", {
      code: "AI_EMPTY_EMBEDDING",
      publicMessage: "The AI service could not create a message embedding.",
    })
  }
  return vector
}

module.exports = {
  generateResponse,
  generateVector,
}
