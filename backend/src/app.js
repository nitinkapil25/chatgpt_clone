const express = require('express')
const cookieParser = require("cookie-parser")
const path = require('path')

//Routes
const authRoutes = require("./routes/auth.routes")
const chatRoutes = require("./routes/chat.routes")

const app = express()

//middleware
app.use(express.json())
app.use(cookieParser())
app.use(express.static(path.join(__dirname, '../public')))

//using routes
app.use('/api/auth', authRoutes) //main express se connect karna
app.use('/api/chat', chatRoutes )
app.get(/^(?!\/api(?:\/|$)|\/socket\.io(?:\/|$)).*/, (req, res, next) => {
    if (!req.accepts('html')) return next()
    res.sendFile(path.join(__dirname, '../public/index.html'))
})
module.exports = app
