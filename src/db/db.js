const mongoose = require("mongoose")

async function connectDb(){

    try{
        await mongoose.connect(process.env.MONGO_URI)
        console.log("connected to mongoDB");
        
    }catch(err){
        console.log("error connecting to mongoDB", err);
        
    }
}

module.exports = connectDb