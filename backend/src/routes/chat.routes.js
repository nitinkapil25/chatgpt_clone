const express = require('express')
const authMiddleware = require('../middlewares/auth.middleware')
const chatController = require("../controllers/chat.controller")

const router = express.Router()

//routes
router.get('/', authMiddleware.authuser, chatController.listChats)
router.post('/', authMiddleware.authuser, chatController.createChat)
router.get('/:chatId/messages', authMiddleware.authuser, chatController.getChatMessages)
router.patch('/:chatId', authMiddleware.authuser, chatController.renameChat)
router.delete('/:chatId', authMiddleware.authuser, chatController.deleteChat)


module.exports = router
