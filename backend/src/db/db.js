const mongoose = require("mongoose")

async function connectDb(){

    try{
        await mongoose.connect(process.env.MONGO_URI)
        console.log("connected to mongoDB");
        
    }catch(err){
        console.error("MongoDB connection failed", {
            name: typeof err?.name === "string" ? err.name : "Error",
            ...(Number.isInteger(err?.code) ? { code: err.code } : {}),
        });
        
    }
}

module.exports = connectDb
