const express = require("express");
const bcrypt = require("bcryptjs");
const jsonwebtoken = require("jsonwebtoken");
const User = require("../models/User");

const authRouter = express.Router();
const BCRYPT_SALT_ROUNDS = 12;
const JSON_WEB_TOKEN_EXPIRATION = "7d";

function generateSessionToken(patientUserId) {
  return jsonwebtoken.sign(
    { userId: patientUserId.toString() },
    process.env.JWT_SECRET,
    { expiresIn: JSON_WEB_TOKEN_EXPIRATION }
  );
}

authRouter.post("/signup", async function signupController(request, response) {
  try {
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body.password === "string" ? request.body.password : "";

    if (!email || !password) {
      return response.status(400).json({
        message: "Both email and password are required to create a personal health companion account."
      });
    }

    if (password.length < 8) {
      return response.status(400).json({
        message: "Password must contain at least eight characters."
      });
    }

    const existingUser = await User.findOne({ email: email });
    if (existingUser) {
      return response.status(409).json({
        message: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const createdUser = await User.create({
      email: email,
      passwordHash: passwordHash
    });

    const sessionToken = generateSessionToken(createdUser._id);

    return response.status(201).json({
      message: "Personal health companion account created successfully.",
      sessionToken: sessionToken,
      email: createdUser.email,
      userId: createdUser._id
    });
  } catch (error) {
    if (error && error.code === 11000) {
      return response.status(409).json({
        message: "An account with this email already exists."
      });
    }

    return response.status(500).json({
      message: "Signup could not be completed because of an unexpected server error.",
      diagnostic: error.message
    });
  }
});

authRouter.post("/login", async function loginController(request, response) {
  try {
    const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const password = typeof request.body.password === "string" ? request.body.password : "";

    if (!email || !password) {
      return response.status(400).json({
        message: "Both email and password are required to open a session."
      });
    }

    const existingUser = await User.findOne({ email: email });
    if (!existingUser) {
      return response.status(401).json({
        message: "Email or password did not match any personal health companion account."
      });
    }

    const passwordMatchesStoredHash = await bcrypt.compare(password, existingUser.passwordHash);
    if (!passwordMatchesStoredHash) {
      return response.status(401).json({
        message: "Email or password did not match any personal health companion account."
      });
    }

    const sessionToken = generateSessionToken(existingUser._id);

    return response.status(200).json({
      message: "Session established successfully.",
      sessionToken: sessionToken,
      email: existingUser.email,
      userId: existingUser._id
    });
  } catch (error) {
    return response.status(500).json({
      message: "Login could not be completed because of an unexpected server error.",
      diagnostic: error.message
    });
  }
});

module.exports = authRouter;
