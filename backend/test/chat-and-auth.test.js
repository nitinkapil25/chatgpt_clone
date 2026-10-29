const test = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const http = require("node:http")
const express = require("express")
const cookieParser = require("cookie-parser")

const sourcePath = path.resolve(__dirname, "../src")
const userModelPath = path.join(sourcePath, "models/user.model.js")
const chatModelPath = path.join(sourcePath, "models/chat.model.js")
const messageModelPath = path.join(sourcePath, "models/message.model.js")
const vectorServicePath = path.join(sourcePath, "services/vector.service.js")

const chatModel = {}
const messageModel = {}
let deleteMemoryHandler = async () => {}
const vectorService = { deleteMemoriesByIds: (...args) => deleteMemoryHandler(...args) }
const userModel = { findById: async () => null }

function stubModule(modulePath, exports) {
    require.cache[modulePath] = {
        id: modulePath,
        filename: modulePath,
        loaded: true,
        exports
    }
}

stubModule(userModelPath, userModel)
stubModule(chatModelPath, chatModel)
stubModule(messageModelPath, messageModel)
stubModule(vectorServicePath, vectorService)

const chatController = require(path.join(sourcePath, "controllers/chat.controller.js"))
const authController = require(path.join(sourcePath, "controllers/auth.controller.js"))
const { authuser } = require(path.join(sourcePath, "middlewares/auth.middleware.js"))
const jwt = require("jsonwebtoken")
const authRoutes = require(path.join(sourcePath, "routes/auth.routes.js"))
const chatRoutes = require(path.join(sourcePath, "routes/chat.routes.js"))

const validChatId = "64b000000000000000000001"
const ownerId = "64b000000000000000000002"
const otherUserId = "64b000000000000000000003"

function response() {
    return {
        statusCode: 200,
        body: null,
        clearedCookie: null,
        status(code) {
            this.statusCode = code
            return this
        },
        json(body) {
            this.body = body
            return this
        },
        clearCookie(name, options) {
            this.clearedCookie = { name, options }
            return this
        }
    }
}

function resetMocks() {
    for (const key of Object.keys(chatModel)) delete chatModel[key]
    for (const key of Object.keys(messageModel)) delete messageModel[key]
    deleteMemoryHandler = async () => {}
}

test("logout clears the httpOnly token cookie and returns success", () => {
    const res = response()
    authController.logoutUser({}, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.message, "logged out successfully")
    assert.equal(res.clearedCookie.name, "token")
    assert.equal(res.clearedCookie.options.httpOnly, true)
    assert.equal(res.clearedCookie.options.path, "/")
    assert.ok(["strict", "lax", "none"].includes(res.clearedCookie.options.sameSite))
})

test("authentication middleware rejects missing cookies", async () => {
    const res = response()
    let nextCalled = false
    await authuser({ cookies: undefined }, res, () => { nextCalled = true })
    assert.equal(res.statusCode, 401)
    assert.equal(nextCalled, false)
})

test("rename validates IDs and titles before querying Mongo", async (t) => {
    resetMocks()
    let updates = 0
    chatModel.findOneAndUpdate = async () => { updates += 1 }

    for (const [params, body, status] of [
        [{ chatId: "bad-id" }, { title: "valid" }, 400],
        [{ chatId: validChatId }, { title: "   " }, 400],
        [{ chatId: validChatId }, { title: "x".repeat(121) }, 400],
        [{ chatId: validChatId }, { title: 42 }, 400],
    ]) {
        await t.test(`${status} for ${JSON.stringify(body)}`, async () => {
            const res = response()
            await chatController.renameChat({ params, body, user: { _id: ownerId } }, res)
            assert.equal(res.statusCode, status)
            assert.equal(updates, 0)
        })
    }
})

test("list chats is scoped to the authenticated user and sorted by recent activity", async () => {
    resetMocks()
    let filter
    let sort
    const rows = [{ _id: validChatId, title: "Owned", createdAt: new Date(), updatedAt: new Date(), lastActivity: new Date() }]
    chatModel.find = (query) => {
        filter = query
        return {
            select(fields) {
                assert.equal(fields, "_id title createdAt updatedAt lastActivity")
                return this
            },
            sort(order) { sort = order; return this },
            async lean() { return rows },
        }
    }
    const res = response()
    await chatController.listChats({ user: { _id: ownerId } }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(filter, { user: ownerId })
    assert.deepEqual(sort, { updatedAt: -1, lastActivity: -1 })
    assert.deepEqual(res.body.chats, rows)
})

test("message history verifies ownership before returning messages", async () => {
    resetMocks()
    const messages = [{ _id: "64b000000000000000000011", role: "user", content: "hello", createdAt: new Date() }]
    let chatFilter
    let messageFilter
    let sort
    chatModel.findOne = (filter) => {
        chatFilter = filter
        return { select() { return this }, async lean() { return { _id: validChatId } } }
    }
    messageModel.find = (filter) => {
        messageFilter = filter
        return {
            select() { return this },
            sort(order) { sort = order; return this },
            async lean() { return messages },
        }
    }
    const res = response()
    await chatController.getChatMessages({ params: { chatId: validChatId }, user: { _id: ownerId } }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(chatFilter, { _id: validChatId, user: ownerId })
    assert.deepEqual(messageFilter, { chat: validChatId, user: ownerId })
    assert.deepEqual(sort, { createdAt: 1, _id: 1 })
    assert.deepEqual(res.body.messages, messages)
})

test("message history refuses chats owned by another user", async () => {
    resetMocks()
    let messageQueries = 0
    chatModel.findOne = (filter) => {
        assert.deepEqual(filter, { _id: validChatId, user: otherUserId })
        return { select() { return this }, async lean() { return null } }
    }
    messageModel.find = () => { messageQueries += 1 }
    const res = response()
    await chatController.getChatMessages({ params: { chatId: validChatId }, user: { _id: otherUserId } }, res)
    assert.equal(res.statusCode, 404)
    assert.equal(messageQueries, 0)
})

test("rename trims title and scopes update to the authenticated owner", async () => {
    resetMocks()
    let query
    let update
    let options
    chatModel.findOneAndUpdate = async (filter, changes, updateOptions) => {
        query = filter
        update = changes
        options = updateOptions
        return { _id: validChatId, title: changes.$set.title, lastActivity: null }
    }
    const res = response()
    await chatController.renameChat({
        params: { chatId: validChatId },
        body: { title: "  Project notes  ", user: otherUserId },
        user: { _id: ownerId }
    }, res)
    assert.equal(res.statusCode, 200)
    assert.equal(res.body.chat.title, "Project notes")
    assert.deepEqual(query, { _id: validChatId, user: ownerId })
    assert.deepEqual(update, { $set: { title: "Project notes" } })
    assert.equal(options.returnDocument, "after")
    assert.equal("new" in options, false)
})

test("rename returns 404 when the chat is missing or belongs to another user", async () => {
    resetMocks()
    let query
    chatModel.findOneAndUpdate = async (filter) => { query = filter; return null }
    const res = response()
    await chatController.renameChat({
        params: { chatId: validChatId }, body: { title: "Renamed" }, user: { _id: otherUserId }
    }, res)
    assert.equal(res.statusCode, 404)
    assert.deepEqual(query, { _id: validChatId, user: otherUserId })
})

test("delete removes only the owned chat messages and their vector IDs", async () => {
    resetMocks()
    const messageIds = ["64b000000000000000000011", "64b000000000000000000012"]
    const calls = []
    chatModel.findOne = async (filter) => {
        calls.push(["findChat", filter])
        return { _id: validChatId, user: ownerId }
    }
    messageModel.find = (filter) => {
        calls.push(["findMessages", filter])
        return { select() { return this }, async lean() { return messageIds.map((_id) => ({ _id })) } }
    }
    deleteMemoryHandler = async (ids) => calls.push(["deleteVectors", ids])
    messageModel.deleteMany = async (filter) => calls.push(["deleteMessages", filter])
    chatModel.deleteOne = async (filter) => { calls.push(["deleteChat", filter]); return { deletedCount: 1 } }

    const res = response()
    await chatController.deleteChat({ params: { chatId: validChatId }, user: { _id: ownerId } }, res)
    assert.equal(res.statusCode, 200)
    assert.deepEqual(calls, [
        ["findChat", { _id: validChatId, user: ownerId }],
        ["findMessages", { chat: validChatId, user: ownerId }],
        ["deleteVectors", messageIds],
        ["deleteMessages", { chat: validChatId, user: ownerId }],
        ["deleteChat", { _id: validChatId, user: ownerId }],
    ])
})

test("delete rejects invalid, missing, and other-user chat IDs without deleting data", async (t) => {
    for (const scenario of [
        { name: "invalid ID", id: "nope", found: false, status: 400 },
        { name: "missing chat", id: validChatId, found: false, status: 404 },
        { name: "chat owned by another user", id: validChatId, found: false, status: 404 },
    ]) {
        await t.test(scenario.name, async () => {
            resetMocks()
            let lookup
            let mutations = 0
            chatModel.findOne = async (filter) => { lookup = filter; return scenario.found ? { _id: validChatId } : null }
            messageModel.find = () => { mutations += 1; throw new Error("must not read messages") }
            chatModel.deleteOne = async () => { mutations += 1 }
            const res = response()
            await chatController.deleteChat({ params: { chatId: scenario.id }, user: { _id: otherUserId } }, res)
            assert.equal(res.statusCode, scenario.status)
            assert.equal(mutations, 0)
            if (scenario.status === 404) assert.deepEqual(lookup, { _id: validChatId, user: otherUserId })
        })
    }
})

test("delete does not remove Mongo records if vector deletion fails", async () => {
    resetMocks()
    let mongoMutations = 0
    chatModel.findOne = async () => ({ _id: validChatId, user: ownerId })
    messageModel.find = () => ({ select() { return this }, async lean() { return [{ _id: "64b000000000000000000011" }] } })
    deleteMemoryHandler = async () => { throw new Error("provider unavailable") }
    messageModel.deleteMany = async () => { mongoMutations += 1 }
    chatModel.deleteOne = async () => { mongoMutations += 1 }
    const res = response()
    await chatController.deleteChat({ params: { chatId: validChatId }, user: { _id: ownerId } }, res)
    assert.equal(res.statusCode, 500)
    assert.equal(mongoMutations, 0)
})

test("authenticated middleware attaches the user from the token, not request data", async () => {
    resetMocks()
    process.env.JWT_SECRET = "controller-test-secret"
    const user = { _id: ownerId }
    userModel.findById = async (id) => id === ownerId ? user : null
    const token = jwt.sign({ id: ownerId }, process.env.JWT_SECRET)
    const req = { cookies: { token }, body: { user: otherUserId } }
    const res = response()
    let nextCalled = false
    await authuser(req, res, () => { nextCalled = true })
    assert.equal(res.statusCode, 200)
    assert.equal(nextCalled, true)
    assert.equal(req.user, user)
})

test("authenticated HTTP routes logout, rename, and delete through the auth middleware", async (t) => {
    resetMocks()
    process.env.JWT_SECRET = "route-test-secret"
    userModel.findById = async (id) => id === ownerId ? { _id: ownerId } : id === otherUserId ? { _id: otherUserId } : null

    const app = express()
    app.use(express.json())
    app.use(cookieParser())
    app.use("/api/auth", authRoutes)
    app.use("/api/chat", chatRoutes)
    const server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    t.after(() => new Promise((resolve) => server.close(resolve)))

    const baseUrl = `http://127.0.0.1:${server.address().port}`
    const ownerToken = jwt.sign({ id: ownerId }, process.env.JWT_SECRET)
    const otherToken = jwt.sign({ id: otherUserId }, process.env.JWT_SECRET)
    const ownerHeaders = { Cookie: `token=${ownerToken}`, "Content-Type": "application/json" }

    const unauthenticated = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST" })
    assert.equal(unauthenticated.status, 401)

    const unauthenticatedChats = await fetch(`${baseUrl}/api/chat`)
    assert.equal(unauthenticatedChats.status, 401)
    chatModel.find = (filter) => ({
        select() { return this },
        sort() { return this },
        async lean() { return filter.user === ownerId ? [{ _id: validChatId, title: "Saved chat" }] : [] },
    })
    const listedChats = await fetch(`${baseUrl}/api/chat`, { headers: ownerHeaders })
    assert.equal(listedChats.status, 200)
    assert.equal((await listedChats.json()).chats[0].title, "Saved chat")

    chatModel.findOne = (filter) => ({
        select() { return this },
        async lean() { return filter.user === ownerId ? { _id: validChatId } : null },
    })
    let historyQueries = 0
    messageModel.find = (filter) => {
        historyQueries += 1
        return {
            select() { return this },
            sort() { return this },
            async lean() { return filter.user === ownerId ? [{ _id: "64b000000000000000000011", role: "user", content: "Saved message" }] : [] },
        }
    }
    const loadedMessages = await fetch(`${baseUrl}/api/chat/${validChatId}/messages`, { headers: ownerHeaders })
    assert.equal(loadedMessages.status, 200)
    assert.equal((await loadedMessages.json()).messages[0].content, "Saved message")
    const historyQueriesBeforeUnauthorized = historyQueries
    const forbiddenHistory = await fetch(`${baseUrl}/api/chat/${validChatId}/messages`, {
        headers: { Cookie: `token=${otherToken}` },
    })
    assert.equal(forbiddenHistory.status, 404)
    assert.equal(historyQueries, historyQueriesBeforeUnauthorized)

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: ownerHeaders })
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get("set-cookie"), /token=;/)
    assert.match(logout.headers.get("set-cookie"), /HttpOnly/i)

    chatModel.findOneAndUpdate = async (filter, changes) => filter.user === ownerId
        ? { _id: validChatId, title: changes.$set.title, lastActivity: null }
        : null
    const rename = await fetch(`${baseUrl}/api/chat/${validChatId}`, {
        method: "PATCH", headers: ownerHeaders, body: JSON.stringify({ title: "  Via route  ", user: otherUserId })
    })
    assert.equal(rename.status, 200)
    assert.equal((await rename.json()).chat.title, "Via route")

    const attackerHeaders = { Cookie: `token=${otherToken}`, "Content-Type": "application/json" }
    const forbiddenRename = await fetch(`${baseUrl}/api/chat/${validChatId}`, {
        method: "PATCH", headers: attackerHeaders, body: JSON.stringify({ title: "Tampered" })
    })
    assert.equal(forbiddenRename.status, 404)

    chatModel.findOne = async (filter) => filter.user === ownerId ? { _id: validChatId } : null
    const deletedIds = []
    messageModel.find = () => ({ select() { return this }, async lean() { return [{ _id: "64b000000000000000000011" }] } })
    deleteMemoryHandler = async (ids) => deletedIds.push(...ids)
    messageModel.deleteMany = async () => ({ deletedCount: 1 })
    chatModel.deleteOne = async (filter) => ({ deletedCount: filter.user === ownerId ? 1 : 0 })

    const forbiddenDelete = await fetch(`${baseUrl}/api/chat/${validChatId}`, { method: "DELETE", headers: attackerHeaders })
    assert.equal(forbiddenDelete.status, 404)
    assert.deepEqual(deletedIds, [])

    const deletion = await fetch(`${baseUrl}/api/chat/${validChatId}`, { method: "DELETE", headers: ownerHeaders })
    assert.equal(deletion.status, 200)
    assert.deepEqual(deletedIds, ["64b000000000000000000011"])
})
