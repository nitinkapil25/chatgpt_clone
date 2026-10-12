const express = require('express')
const cookieParser = require("cookie-parser")

//Routes
const authRoutes = require("../src/routes/auth.routes")
const chatRoutes = require("../src/routes/chat.routes")

const app = express()

//middleware
app.use(express.json())
app.use(cookieParser())

//using routes
app.use('/api/auth', authRoutes) //main express se connect karna
app.use('/api/chat', chatRoutes )

module.exports = app