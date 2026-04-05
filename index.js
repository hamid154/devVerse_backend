require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");

app.use(express.json());
app.use(cors());

// =======================
// DB CONNECTION
// =======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log("MongoDB Connection Error ❌:", err));

// =======================
// MODELS
// =======================
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, required: true },
  password: { type: String, required: true },
});
const User = mongoose.model("mytools", userSchema, "mytools");

// =======================
// DB STATUS TEST
// =======================
app.get("/test-db", async (req, res) => {
  try {
    const isConnected = mongoose.connection.readyState === 1;
    if (isConnected) {
      const count = await User.countDocuments();
      res.json({ status: "Connected ✅", database: "DevVerse", collection: "mytools", users: count });
    } else {
      res.status(500).json({ status: "Disconnected ❌", state: mongoose.connection.readyState });
    }
  } catch (err) {
    res.status(500).json({ status: "Error ❌", message: err.message });
  }
});


// =======================
// SIMPLE AUTH SYSTEM (DIRECT SIGNUP)
// =======================

// 1. INSTANT SIGNUP / REGISTER
// Now uses /register but supports legacy /send-signup-otp
app.post(["/register", "/send-signup-otp"], async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  try {
    const normalizedEmail = email.toLowerCase();
    
    // Create/Update user instantly
    const user = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { name: name || "User", email: normalizedEmail, password },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    console.log(`[AUTH] Registration/Reset Success: ${normalizedEmail}`);
    res.json({ message: "User registered successfully", name: user.name });
  } catch (err) {
    console.error("[AUTH ERROR]:", err.message);
    res.status(500).json({ error: "Server error during registration" });
  }
});

// Legacy support: In case old frontend tries to verify
app.post("/verify-signup", (req, res) => {
  res.json({ message: "User registered successfully" });
});

// 2. STABLE LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user || user.password !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    console.log(`[LOGIN] Success: ${email}`);
    res.json({ message: "Login successful", name: user.name });
  } catch (err) {
    console.error("[LOGIN ERROR]:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// =======================
// AI SYSTEM (GEMINI 2.5 FLASH)
// =======================
let currentKeyIndex = 0;

app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(Boolean);

  if (keys.length === 0) return res.status(500).json({ error: "No AI keys" });

  for (let i = 0; i < keys.length; i++) {
    const key = keys[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;

    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );

      if (response.data && response.data.candidates && response.data.candidates[0]) {
        return res.json({ text: response.data.candidates[0].content.parts[0].text });
      }
    } catch (err) {
      console.error(`[AI FAIL] Index ${currentKeyIndex}:`, err.message);
      continue;
    }
  }
  res.status(429).json({ error: "AI keys exhausted" });
});

app.get("/", (req, res) => { res.send("DevVerse Live 🚀 (Simple Auth)"); });

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});