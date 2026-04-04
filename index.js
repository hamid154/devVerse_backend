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
// SEND OTP (PRODUCTION READY)
// =======================
app.post("/send-signup-otp", async (req, res) => {
  const { name, email, password } = req.body;
  console.log(`[OTP] Request received for: ${email}`);

  try {
    // 1. Check if user exists
    let user = await User.findOne({ email });
    if (user) {
      console.log(`[OTP] Account already exists for: ${email}`);
      return res.status(400).json({ error: "Account already exists." });
    }

    // 2. Generate OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // 3. Save OTP to DB (Delete old one first)
    await Otp.deleteMany({ email });
    await Otp.create({ email, otp: otpCode });
    console.log(`[OTP] Code generated and saved to DB`);

    // 4. Send Email via Resend
    const fromEmail = process.env.RESEND_FROM_EMAIL || "DevVerse <onboarding@resend.dev>";
    
    console.log(`[RESEND] Attempting to send from: ${fromEmail} to: ${email}`);

    const { data, error } = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Your DevVerse Verification Code",
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #333;">Welcome to DevVerse!</h2>
          <p>Your verification code is:</p>
          <h1 style="color: #007bff; letter-spacing: 5px;">${otpCode}</h1>
          <p>This code will expire in 5 minutes.</p>
        </div>
      `
    });

    if (error) {
      console.error("[RESEND ERROR]:", error);
      return res.status(500).json({ error: "Failed to send email. Check Resend dashboard/domain verification." });
    }

    console.log("[RESEND SUCCESS]:", data);
    return res.json({ message: "OTP_SENT", resendId: data.id });

  } catch (err) {
    console.error("[SERVER ERROR]:", err.message);
    res.status(500).json({ error: "Internal server error during OTP process." });
  }
});

// =======================
// VERIFY SIGNUP
// =======================
app.post("/verify-signup", async (req, res) => {
  const { name, email, password, otp } = req.body;
  console.log(`[VERIFY] verifying OTP for: ${email}`);

  try {
    const record = await Otp.findOne({ email });

    if (!record) {
      return res.status(400).json({ error: "OTP expired" });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ error: "Wrong OTP" });
    }

    await Otp.deleteMany({ email });

    const newUser = new User({ name, email, password });
    await newUser.save();

    console.log(`[VERIFY] User registered successfully: ${email}`);
    res.json({ message: "User registered successfully" });

  } catch (err) {
    console.error("[VERIFY ERROR]:", err);
    res.status(500).json({ error: "Server error during verification" });
  }
});

// =======================
// LOGIN
// =======================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    let user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ error: "Account not found" });
    }

    if (user.password !== password) {
      return res.json({ message: "Wrong password" });
    }

    console.log(`[LOGIN] Success: ${email}`);
    res.json({ message: "Login successful", name: user.name });

  } catch (err) {
    console.error("[LOGIN ERROR]:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// AI SYSTEM (ULTIMATE FAILOVER CHAIN)
// =======================
let currentKeyIndex = 0;

app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  // 1. TRY DEEPSEEK FIRST
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey && deepseekKey.trim() !== "") {
    try {
      const dlResponse = await axios.post("https://api.deepseek.com/chat/completions", {
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7
      }, {
        headers: { "Authorization": `Bearer ${deepseekKey}` },
        timeout: 10000 // 10s timeout
      });

      console.log("[AI] DeepSeek Responded ✅");
      return res.json({ text: dlResponse.data.choices[0].message.content });
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.error(`[AI] DeepSeek Failed (Code: ${err.response?.status || "ERR"}): ${errMsg}`);
    }
  }

  // 2. FALLBACK TO GEMINI ROTATION
  const geminiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(k => k && k.trim() !== "");

  if (geminiKeys.length === 0) {
    return res.status(500).json({ error: "No Gemini AI API keys configured. Check Render settings." });
  }

  // Model Candidates to try if gemini-1.5-flash returns 404
  const modelCandidates = ["gemini-1.5-flash", "gemini-pro", "gemini-1.5-flash-latest"];

  // Try each Gemini key
  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[currentKeyIndex];
    const currentIndex = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;

    // Try each model candidate for the current key
    for (const model of modelCandidates) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
          { contents: [{ parts: [{ text: prompt }] }] },
          { timeout: 15000 }
        );

        if (response.data && response.data.candidates && response.data.candidates[0]) {
          console.log(`[AI] Gemini Success (Key: ${currentIndex}, Model: ${model}) ✅`);
          return res.json({
            text: response.data.candidates[0].content.parts[0].text
          });
        }
      } catch (err) {
        const status = err.response?.status;
        const errMsg = err.response?.data?.[0]?.error?.message || err.response?.data?.error?.message || err.message;
        
        // If 404, we try the next model candidate. Otherwise, we try the next key.
        if (status === 404) {
          console.warn(`[AI] Gemini 404 (Key: ${currentIndex}, Model: ${model}) - Trying next model...`);
          continue; 
        } else {
          console.error(`[AI] Gemini Failed (Key: ${currentIndex}, Model: ${model}, Status: ${status}): ${errMsg}`);
          break; // Move to the next key
        }
      }
    }
  }

  res.status(429).json({ error: "All AI providers and models (DeepSeek + Gemini) are currently unavailable or rate-limited." });
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`👉 DB URI: ${process.env.MONGO_URI ? "CONNECTED" : "MISSING"}`);
  console.log(`👉 Resend Key: ${process.env.RESEND_API_KEY ? "CONFIGURED" : "MISSING"}\n`);
});