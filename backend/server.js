const path = require("path");
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const authRouter = require("./routes/auth");
const scheduleRouter = require("./routes/schedule");

const expressApplication = express();
const LISTENING_PORT = Number(process.env.PORT) || 5000;
const MONGODB_CLUSTER_URI = process.env.MONGODB_URI;

expressApplication.use(
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  })
);
expressApplication.use(express.json({ limit: "1mb" }));

expressApplication.use("/api/auth", authRouter);
expressApplication.use("/api/schedule", scheduleRouter);

expressApplication.get("/api/health", function healthProbe(_request, response) {
  response.status(200).json({
    product: "Patient-Centric Medication Consensus Router",
    architecture: "Direct-to-Consumer personal health companion",
    status: "operational"
  });
});

async function startExpressRunner() {
  try {
    if (!MONGODB_CLUSTER_URI) {
      throw new Error("MONGODB_URI is not configured in backend/.env.");
    }

    await mongoose.connect(MONGODB_CLUSTER_URI);
    console.log("Connected to MongoDB Atlas cluster medRouter");

    expressApplication.listen(LISTENING_PORT, function onListening() {
      console.log("Patient-Centric Medication Consensus Router backend listening on port " + LISTENING_PORT);
    });
  } catch (error) {
    console.error("Express runner failed to initialize:", error.message);
    process.exit(1);
  }
}

startExpressRunner();
