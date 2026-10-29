const express = require("express")
const authControllers = require("../controllers/auth.controller")
const authMiddleware = require("../middlewares/auth.middleware")

const router = express.Router();

//auth routes

router.post("/register", authControllers.registerUser)
router.post("/login", authControllers.loginUser)
router.post("/logout", authMiddleware.authuser, authControllers.logoutUser)



module.exports = router
