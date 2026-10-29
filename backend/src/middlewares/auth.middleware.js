const userModel = require("../models/user.model")
const jwt = require("jsonwebtoken")

async function authuser(req,res,next) {
    //first take token
    const { token } = req.cookies || {}
    //check if token exists
    if(!token) {
        return res.status(401).json({message: "unauthorized access"})
    }
    //verify token
    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        //find user with token(user.id)
        const user = await userModel.findById(decoded.id)
        if (!user) {
            return res.status(401).json({message: "unauthorized access"})
        }
        //save user for future usecase
        req.user = user;

        next()

    }catch(err){
        return res.status(401).json({message: "unauthorized access"})
    }
}

module.exports = {
    authuser
}
