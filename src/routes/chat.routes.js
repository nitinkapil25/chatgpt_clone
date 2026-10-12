const express = require('express')
const authMiddleware = require('../middlewares/auth.middleware')
const chatController = require("../controllers/chat.controller")

const router = express.Router()

//routes
router.post('/', authMiddleware.authuser, chatController.createChat)


module.exports = router