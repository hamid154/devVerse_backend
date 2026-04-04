require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const { Resend } = require("resend");
const { GoogleGenerativeAI } = require("@google/generative-ai");

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
// DIAGNOSTICS: Check Available Models for Gemini
// =======================
async function checkAvailableModels() {
  const primaryKey = process.env.GEMINI_API_KEY;
  if (!primaryKey) return;
  
  try {
    const genAI = new GoogleGenerativeAI(primaryKey);
    // Use raw axios to list models since the SDK doesn't always expose it clearly in all versions
    const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${primaryKey}`);
    const models = response.data.models.map(m => m.name.replace("models/", ""));
    console.log("\n-------------------------------------------");
    console.log("👉 [STARTUP] AVAILABLE GEMINI MODELS:");
    console.log(models.join(", "));
    console.log("-------------------------------------------\n");
  } catch (err) {
    console.warn("⚠️ [STARTUP] Could not fetch Gemini model list:", err.message);
  }
}

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
    let user = await User.findOne({ email });
    if (user) {
      console.log(`[OTP] Account already exists for: ${email}`);
      return res.status(400).json({ error: "Account already exists." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    await Otp.deleteMany({ email });
    await Otp.create({ email, otp: otpCode });
    console.log(`[OTP] Code generated and saved to DB`);

    const fromEmail = process.env.RESEND_FROM_EMAIL || "DevVerse <onboarding@resend.dev>";
    
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
      return res.status(500).json({ error: "Failed to send email. Check Resend dashboard." });
    }

    console.log("[RESEND SUCCESS]:", data);
    return res.json({ message: "OTP_SENT", resendId: data.id });
  } catch (err) {
    console.error("[SERVER ERROR]:", err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// =======================
// VERIFY SIGNUP
// =======================
app.post("/verify-signup", async (req, res) => {
  const { name, email, password, otp } = req.body;
  try {
    const record = await Otp.findOne({ email });
    if (!record) return res.status(400).json({ error: "OTP expired" });
    if (record.otp !== otp) return res.status(400).json({ error: "Wrong OTP" });

    await Otp.deleteMany({ email });
    const newUser = new User({ name, email, password });
    await newUser.save();

    console.log(`[VERIFY] User registered successfully: ${email}`);
    res.json({ message: "User registered successfully" });
  } catch (err) {
    console.error("[VERIFY ERROR]:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// LOGIN
// =======================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user) return res.status(404).json({ error: "Account not found" });
    if (user.password !== password) return res.json({ message: "Wrong password" });

    console.log(`[LOGIN] Success: ${email}`);
    res.json({ message: "Login successful", name: user.name });
  } catch (err) {
    console.error("[LOGIN ERROR]:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// =======================
// AI SYSTEM (SUPER FAILOVER CHAIN)
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
        timeout: 10000 
      });

      console.log("[AI] DeepSeek Responded ✅");
      return res.json({ text: dlResponse.data.choices[0].message.content });
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      console.error(`[AI] DeepSeek Failed: ${errMsg}`);
    }
  }

  // 2. FALLBACK TO GEMINI (MULTI-MODEL MAPPING)
  const geminiKeys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(k => k && k.trim() !== "");

  if (geminiKeys.length === 0) {
    return res.status(500).json({ error: "No Gemini keys configured." });
  }

  // Model Candidates to try if gemini-1.5-flash yields 404
  const modelCandidates = ["gemini-1.5-flash", "gemini-pro", "gemini-1.5-flash-latest", "gemini-1.0-pro"];

  // Try each Gemini key
  for (let i = 0; i < geminiKeys.length; i++) {
    const key = geminiKeys[currentKeyIndex];
    const currentIndex = currentKeyIndex;
    currentKeyIndex = (currentKeyIndex + 1) % geminiKeys.length;

    // Try each model for this key
    for (const modelName of modelCandidates) {
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: modelName });
        
        const result = await model.generateContent(prompt);
        const responseText = result.response.text();

        if (responseText) {
          console.log(`[AI] Gemini Success (Key Index: ${currentIndex}, Model: ${modelName}) ✅`);
          return res.json({ text: responseText });
        }
      } catch (err) {
        const status = err.response?.status || err.status;
        const errMsg = err.message;

        if (errMsg.includes("404") || errMsg.includes("not found")) {
          console.warn(`[AI] Gemini 404 (Key: ${currentIndex}, Model: ${modelName}) - Trying next candidate...`);
          continue; 
        } else {
          console.error(`[AI] Gemini Error (Key: ${currentIndex}, Model: ${modelName}): ${errMsg}`);
          break; // Move to next key if not a 404 issue (e.g., 429 quota)
        }
      }
    }
  }

  res.status(429).json({ error: "AI exhausted. Check Render logs for model list." });
});

// =======================
// START SERVER
// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`\n🚀 Server running on port ${PORT}`);
  console.log(`👉 DB URI: ${process.env.MONGO_URI ? "CONNECTED" : "MISSING"}`);
  console.log(`👉 Resend Key: ${process.env.RESEND_API_KEY ? "CONFIGURED" : "MISSING"}`);
  
  // RUN DIAGNOSTICS
  await checkAvailableModels();
});