
const { Server } = require("socket.io");

const io = new Server({/* options*/})

function initSocketServer(httpServer) {

    const io = new Server(httpServer, {})

    io.on("connection", (socket) => {
  console.log("A socket connected:", socket.id);
    })
}

module.exports = initSocketServer