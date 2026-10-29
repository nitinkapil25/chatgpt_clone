const { Server } = require("socket.io")
const cookie = require("cookie")
const jwt = require("jsonwebtoken")
const mongoose = require("mongoose")
const userModel = require("../models/user.model")
const chatModel = require("../models/chat.model")
const aiService = require("../services/ai.service")
const messageModel = require("../models/message.model")
const { createMemory, queryMemory } = require("../services/vector.service")

const MAX_MESSAGE_LENGTH = 8000
const GENERIC_MESSAGE_ERROR = "Your message could not be processed. Please try again."

function safeErrorCode(error) {
    const code = typeof error?.code === "string" ? error.code : "MESSAGE_PROCESSING_FAILED"
    return /^[A-Z0-9_]{1,48}$/.test(code) ? code : "MESSAGE_PROCESSING_FAILED"
}

function emitMessageError(socket, chatId, error) {
    const status = Number(error?.status)
    const diagnostic = {
        stage: error?.stage || "message_processing",
        code: safeErrorCode(error),
        ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { status } : {}),
    }
    // Do not log raw exceptions, request content, cookies, or tokens.
    console.error("Socket AI message failed", diagnostic)

    try {
        socket.emit("ai-error", {
            ...(typeof chatId === "string" ? { chat: chatId } : {}),
            code: diagnostic.code,
            message: typeof error?.publicMessage === "string" ? error.publicMessage : GENERIC_MESSAGE_ERROR,
        })
    } catch {
        // The client may have disconnected while the request was processing.
    }
}

function makeRequestError(code, publicMessage) {
    const error = new Error(code)
    error.code = code
    error.publicMessage = publicMessage
    return error
}

function initSocketServer(httpServer) {
    const io = new Server(httpServer, {})

    io.use(async (socket, next) => {
        try {
            const cookies = cookie.parse(socket.handshake.headers?.cookie || "")
            if (!cookies.token) return next(new Error("Authentication required"))

            const decoded = jwt.verify(cookies.token, process.env.JWT_SECRET)
            const user = await userModel.findById(decoded.id)
            if (!user) return next(new Error("Invalid token"))

            socket.user = user
            return next()
        } catch {
            return next(new Error("Invalid token"))
        }
    })

    io.on("connection", (socket) => {
        socket.on("ai-message", async (messagePayload) => {
            const chatId = messagePayload?.chat
            let stage = "validate_request"

            try {
                if (!messagePayload || Array.isArray(messagePayload)
                    || typeof chatId !== "string"
                    || !/^[a-f\d]{24}$/i.test(chatId)
                    || !mongoose.isValidObjectId(chatId)
                    || typeof messagePayload.content !== "string"
                    || !messagePayload.content.trim()
                    || messagePayload.content.length > MAX_MESSAGE_LENGTH) {
                    throw makeRequestError("INVALID_MESSAGE", "Enter a valid message and try again.")
                }

                stage = "authorize_chat"
                const chat = await chatModel.findOne({ _id: chatId, user: socket.user._id })
                if (!chat) {
                    throw makeRequestError("CHAT_NOT_FOUND", "This chat could not be found. Start a new chat and try again.")
                }

                const content = messagePayload.content.trim()
                stage = "save_user_message"
                const [message, vectors] = await Promise.all([
                    messageModel.create({
                        chat: chat._id,
                        user: socket.user._id,
                        content,
                        role: "user",
                    }),
                    aiService.generateVector(content),
                ])

                stage = "save_user_memory"
                await createMemory({
                    vectors,
                    messageId: message._id,
                    metadata: {
                        chat: chat._id,
                        user: socket.user._id,
                        text: content,
                    },
                })

                stage = "load_context"
                const [memory, chatHistory] = await Promise.all([
                    queryMemory({
                        queryVector: vectors,
                        limit: 20,
                        metadata: { user: socket.user._id },
                    }),
                    messageModel.find({ chat: chat._id, user: socket.user._id })
                        .sort({ createdAt: -1 })
                        .limit(20)
                        .lean()
                        .then((messages) => messages.reverse()),
                ])

                const stm = chatHistory.map((item) => ({
                    role: item.role,
                    parts: [{ text: item.content }],
                }))
                const relevantMemories = memory
                    .map((item) => item.metadata?.text)
                    .filter((text) => typeof text === "string" && text.length > 0)
                const ltm = [{
                    role: "user",
                    parts: [{
                        text: `These are relevant messages from this user's previous chats. Use them when helpful:\n${relevantMemories.join("\n")}`,
                    }],
                }]

                stage = "generate_response"
                const response = await aiService.generateResponse([...ltm, ...stm])

                stage = "save_assistant_response"
                const [responseMessage, responseVector] = await Promise.all([
                    messageModel.create({
                        chat: chat._id,
                        user: socket.user._id,
                        content: response,
                        role: "model",
                    }),
                    aiService.generateVector(response),
                ])

                stage = "save_assistant_memory"
                await createMemory({
                    vectors: responseVector,
                    messageId: responseMessage._id,
                    metadata: {
                        chat: chat._id,
                        user: socket.user._id,
                        text: response,
                    },
                })

                socket.emit("ai-response", { content: response, chat: chatId })
            } catch (error) {
                const failure = error instanceof Error ? error : new Error(GENERIC_MESSAGE_ERROR)
                failure.stage = stage
                emitMessageError(socket, chatId, failure)
            }
        })
    })

    return io
}

module.exports = initSocketServer
