const chatModel = require("../models/chat.model")
const messageModel = require("../models/message.model")
const mongoose = require("mongoose")
const { deleteMemoriesByIds } = require("../services/vector.service")

const MAX_CHAT_TITLE_LENGTH = 120

function getChatId(req, res) {
    const { chatId } = req.params
    if (!/^[a-f\d]{24}$/i.test(chatId || "") || !mongoose.isValidObjectId(chatId)) {
        res.status(400).json({ message: "invalid chat id" })
        return null
    }
    return chatId
}

async function createChat(req,res){

    const { title } = req.body
    const user = req.user
    
    const chat = await chatModel.create({
        user: user._id,
        title
    })

    res.status(201).json({
        message: "chat created successfully",
        chat: {
            _id: chat._id,
            title: chat.title,
            lastActivity: chat.lastActivity,
            user: chat.user
        }
    })
}

async function listChats(req, res) {
    try {
        const chats = await chatModel.find({ user: req.user._id })
            .select("_id title createdAt updatedAt lastActivity")
            .sort({ updatedAt: -1, lastActivity: -1 })
            .lean()
        return res.status(200).json({ chats })
    } catch {
        return res.status(500).json({ message: "failed to load chats" })
    }
}

async function getChatMessages(req, res) {
    const chatId = getChatId(req, res)
    if (!chatId) return

    try {
        const chat = await chatModel.findOne({ _id: chatId, user: req.user._id }).select("_id").lean()
        if (!chat) return res.status(404).json({ message: "chat not found" })

        const messages = await messageModel.find({ chat: chat._id, user: req.user._id })
            .select("_id role content createdAt updatedAt")
            .sort({ createdAt: 1, _id: 1 })
            .lean()
        return res.status(200).json({ messages })
    } catch {
        return res.status(500).json({ message: "failed to load chat messages" })
    }
}

async function renameChat(req, res) {
    const chatId = getChatId(req, res)
    if (!chatId) return

    const rawTitle = req.body && !Array.isArray(req.body) ? req.body.title : undefined
    if (typeof rawTitle !== "string") {
        return res.status(400).json({ message: "title must be a string" })
    }
    const title = rawTitle.trim()
    if (!title) {
        return res.status(400).json({ message: "title cannot be empty" })
    }
    if (title.length > MAX_CHAT_TITLE_LENGTH) {
        return res.status(400).json({ message: `title must be ${MAX_CHAT_TITLE_LENGTH} characters or fewer` })
    }

    try {
        const chat = await chatModel.findOneAndUpdate(
            { _id: chatId, user: req.user._id },
            { $set: { title } },
            { returnDocument: "after", runValidators: true }
        )
        if (!chat) return res.status(404).json({ message: "chat not found" })
        return res.status(200).json({
            message: "chat renamed successfully",
            chat: { _id: chat._id, title: chat.title, lastActivity: chat.lastActivity }
        })
    } catch {
        return res.status(500).json({ message: "failed to rename chat" })
    }
}

async function deleteChat(req, res) {
    const chatId = getChatId(req, res)
    if (!chatId) return

    try {
        const chat = await chatModel.findOne({ _id: chatId, user: req.user._id })
        if (!chat) return res.status(404).json({ message: "chat not found" })

        const messageFilter = { chat: chat._id, user: req.user._id }
        const messages = await messageModel.find(messageFilter).select("_id").lean()
        const vectorIds = messages.map((message) => String(message._id))

        // Pinecone vector IDs are the Mongo message IDs used by createMemory.
        // Deleting by these exact IDs cannot remove memories from other chats.
        await deleteMemoriesByIds(vectorIds)
        await messageModel.deleteMany(messageFilter)
        const result = await chatModel.deleteOne({ _id: chat._id, user: req.user._id })
        if (result.deletedCount !== 1) {
            return res.status(404).json({ message: "chat not found" })
        }

        return res.status(200).json({ message: "chat deleted successfully", chatId })
    } catch {
        return res.status(500).json({ message: "failed to delete chat and its saved memories" })
    }
}

module.exports = {
    listChats,
    getChatMessages,
    createChat,
    renameChat,
    deleteChat
}
