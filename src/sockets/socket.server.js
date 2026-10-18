const { Server } = require("socket.io");//installed socketio ka package 
const cookie = require("cookie")
const jwt = require("jsonwebtoken")
const userModel = require("../models/user.model")
const aiService = require("../services/ai.service")
const messageModel = require("../models/message.model");
const { model } = require("mongoose");


function initSocketServer(httpServer) { //fn that consist basic setup of  socketio

    const io = new Server(httpServer, {})
    // middleware for user auth
    io.use(async(socket, next) => {
        const cookies = cookie.parse(socket.handshake.headers?.cookie || "");
        console.log("socket connection cookies", cookies);
        

        if (!cookies.token) {
            next(new Error("Authentication required"));
        }

        try {
            const decoded = jwt.verify(cookies.token, process.env.JWT_SECRET);
            const user = await userModel.findById(decoded.id)
            socket.user = user;
            next();
        } catch (error) {
          next(new Error("Invalid token"));}
    });

    io.on("connection", (socket) => {
        
        socket.on("ai-message", async(messagePayload)=>{
            /*
            messagePayload = {
                chat: chatId,
                content: "text message"
            }
             */
             console.log(messagePayload);

            //saving user messsage
            await messageModel.create({
                chat:messagePayload.chat,
                user: socket.user._id,
                content: messagePayload.content,
                role: "user"
            })   
            //chat hisstory(short term memory)
            const chatHistory = (await messageModel.find({
                chat: messagePayload.chat
            }).sort({ createdAt: -1}).limit(20).lean()).reverse()
            
            const response = await aiService.generateResponse( chatHistory.map(item => {
                return {
                    role: item.role,
                    parts: [ { text: item.content}]
                }
            }))

            //saving Ai response
            await messageModel.create({
                chat:messagePayload.chat,
                user: socket.user._id,
                content: response,
                role: "model"
            })

            socket.emit('ai-response', {
                content: response,
                chat: messagePayload.chat
            })

            
            
        })
    })
}

module.exports = initSocketServer