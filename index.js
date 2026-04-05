require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const { Resend } = require("resend");

// Initialize Resend
const resend = new Resend(process.env.RESEND_API_KEY);

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

const otpSchema = new mongoose.Schema({
  email: String,
  otp: String,
  createdAt: { type: Date, default: Date.now, expires: 300 },
});
const Otp = mongoose.model("Otp", otpSchema);

// =======================
// TEST ROUTE
// =======================
app.get("/", (req, res) => {
  res.send("DevVerse Backend is Running 🚀");
});

// =======================
// OTP & AUTH APIs (STABLE)
// =======================
app.post("/send-signup-otp", async (req, res) => {
  const { name, email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (user) return res.status(400).json({ error: "Account already exists." });

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await Otp.deleteMany({ email });
    await Otp.create({ email, otp: otpCode });

    const fromEmail = process.env.RESEND_FROM_EMAIL || "DevVerse <onboarding@resend.dev>";
    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Verification Code",
      html: `<div style="font-family:sans-serif;padding:20px;"><h2>Welcome!</h2><p>Your code is: <b>${otpCode}</b></p></div>`
    });

    if (error) return res.status(500).json({ error: "Email failed" });
    res.json({ message: "OTP_SENT" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/verify-signup", async (req, res) => {
  const { name, email, password, otp } = req.body;
  try {
    const record = await Otp.findOne({ email });
    if (!record || record.otp !== otp) return res.status(400).json({ error: "Invalid OTP" });
    await Otp.deleteMany({ email });
    await new User({ name, email, password }).save();
    res.json({ message: "User registered successfully" });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user || user.password !== password) return res.status(401).json({ error: "Invalid credentials" });
    res.json({ message: "Login successful", name: user.name });
  } catch (err) { res.status(500).json({ error: "Server error" }); }
});

// =======================
// AI SYSTEM (GEMINI 2.5 FLASH)
// =======================
let currentKeyIndex = 0;

app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  // List of Gemini Keys from ENV
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(Boolean);

  if (keys.length === 0) return res.status(500).json({ error: "No keys configured" });

  // Try each key in a loop
  for (let i = 0; i < keys.length; i++) {
    const key = keys[currentKeyIndex];
    // Rotate index for NEXT request
    currentKeyIndex = (currentKeyIndex + 1) % keys.length;

    try {
      // Direct Axios Post with v1beta and gemini-2.5-flash
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          contents: [{ parts: [{ text: prompt }] }]
        },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );

      if (response.data && response.data.candidates && response.data.candidates[0]) {
        console.log(`[AI SUCCESS] Key Index ${i} used.`);
        return res.json({
          text: response.data.candidates[0].content.parts[0].text
        });
      }
    } catch (err) {
      console.error(`[AI FAIL] Key Index ${i}:`, err.response?.data?.error?.message || err.message);
      // If error occurs, continue to NEXT key in the loop
      continue;
    }
  }

  res.status(429).json({ error: "All AI keys failed or exhausted. Try again later." });
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});