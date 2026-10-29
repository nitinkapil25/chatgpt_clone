require("dotenv").config()
const app = require("./src/app")
const connectDb = require("./src/db/db")
const initSocketServer = require("./src/sockets/socket.server")
const httpServer = require("http").createServer(app) //Express(app) ko ek raw HTTP server mein wrap kiya.

connectDb()
initSocketServer(httpServer)//wahi HTTP server Socket.IO ko diya.


httpServer.listen(process.env.PORT || 3000, ()=>{
    console.log("server is live");
    
})
