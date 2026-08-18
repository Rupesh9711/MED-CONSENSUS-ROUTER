const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, "A patient email address is required."],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "A valid email address is required."]
    },
    passwordHash: {
      type: String,
      required: [true, "A bcrypt password hash is required."]
    }
  },
  {
    timestamps: true
  }
);
     
module.exports = mongoose.model("User", userSchema);
