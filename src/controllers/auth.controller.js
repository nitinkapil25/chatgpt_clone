const userModel = require("../models/user.model")
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")

//register controller
async function registerUser(req,res) {

    //check if user exists
    const { fullName: {firstName, lastName} , email, password } = req.body; 
    const isUserAlreadyExists = await userModel.findOne({email})

    if(isUserAlreadyExists){
       return res.status(400).json({message: "user already exists"})
    }
    //if user doesnt exists then create new user
    // first bcrypt the password
    const hashPassword = await bcrypt.hash(password, 10)

    //create a new user
    const user = await userModel.create({
        fullName: {
            firstName, lastName
        },
        email,
        password: hashPassword
    })

    //create token
    const token = jwt.sign({id: user._id}, process.env.JWT_SECRET)

    //save token in cookie
    res.cookie("token", token)

    res.status(201).json({
        message: "user registered successfully",
        user: {
            email: user.email,
            _id: user._id,
            fullName: user.fullName
        }
    })
}

//login controller
async function loginUser(req,res) {
    const { email, password } = req.body;

    //check if user is registered
    const user = await userModel.findOne({ email })
    if(!user){
        return res.status(400).json({message: "user does not exists"})
    }

    // check if password entered is correct
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if(!isPasswordValid){
        return res.status(400).json({message: "invalid email or password"})
    }
    // if everything is good then generate token and save in cookies
    const token = jwt.sign({id: user._id}, process.env.JWT_SECRET)
    res.cookie("token", token)

    res.status(200).json({
        message: "user loggedIn successfully",
        user: {
            email: user.email,
            _id: user._id,
            fullName: user.fullName
        }
    })
}

module.exports = {
    registerUser,
    loginUser
}