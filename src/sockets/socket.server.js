const { Server } = require("socket.io");//installed socketio ka package 
const cookie = require("cookie")
const jwt = require("jsonwebtoken")
const userModel = require("../models/user.model")
const aiService = require("../services/ai.service")
const messageModel = require("../models/message.model");
const { model } = require("mongoose");
const { createMemory, queryMemory } = require("../services/vector.service")


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
            // saving user messsage in db
           const message =  await messageModel.create({
                chat:messagePayload.chat,
                user: socket.user._id,
                content: messagePayload.content,
                role: "user"
            })  
            //generating vectors
            const vectors = await aiService.generateVector(messagePayload.content)

             const memory = await queryMemory({
                queryVector: vectors,
                limit: 3,
                metadata: {}
            })

            //storing vectors
            await createMemory({
                vectors,
                messageId: message._id,
                metadata: {
                    chat: messagePayload.chat,
                    user: socket.user._id,
                    text: messagePayload.content
                }
            })

            
            //chat hisstory(short term memory)
            const chatHistory = (await messageModel.find({
                chat: messagePayload.chat
            }).sort({ createdAt: -1}).limit(20).lean()).reverse() //limit  
             
            //generating Ai response
            const response = await aiService.generateResponse( chatHistory.map(item => {
                return {
                    role: item.role,
                    parts: [ { text: item.content}]
                }
            }))

            // saving Ai response
           const responseMessage =  await messageModel.create({
                chat: messagePayload.chat,
                user: socket.user._id,
                content: response,
                role: "model"
            })
            //generating vectors
            const responseVector = await aiService.generateVector(response)
            //storing vectors
            await createMemory({
                vectors: responseVector,
                messageId: responseMessage._id,
                metadata:{
                    chat: messagePayload.chat,
                    user: socket.user._id,
                    text: response
                }
            })
            

            socket.emit('ai-response', {
                content: response,
                chat: messagePayload.chat
            })

            
            
        })
    })
}

module.exports = initSocketServer
