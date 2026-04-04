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
// AI SYSTEM (MIGRATED TO AXIOS)
// =======================
let currentKeyIndex = 0;

app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  let fallbackErrors = [];
  const deepseekKey = process.env.DEEPSEEK_API_KEY;

  // Try DeepSeek first
  if (deepseekKey) {
    try {
      const dlResponse = await axios.post("https://api.deepseek.com/chat/completions", {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      }, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deepseekKey}`
        }
      });

      return res.json({ text: dlResponse.data.choices[0].message.content });
    } catch (err) {
      fallbackErrors.push("DeepSeek failed");
      console.error("[DEEPSEEK ERROR]:", err.message);
    }
  }

  // Fallback to Gemini Round-Robin
  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(Boolean);

  if (keys.length === 0) {
    return res.status(500).json({ error: "No AI API keys available" });
  }

  try {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[currentKeyIndex];
      // Increment index for next call
      currentKeyIndex = (currentKeyIndex + 1) % keys.length;

      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${key}`,
          {
            contents: [{ parts: [{ text: prompt }] }]
          },
          {
            headers: { "Content-Type": "application/json" }
          }
        );

        console.log(`[GEMINI SUCCESS] Key Index ${currentKeyIndex - 1} responded.`);
        return res.json({
          text: response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No response"
        });
      } catch (err) {
        const errMsg = err.response?.data?.error?.message || err.message;
        console.error(`[GEMINI FAIL] Key Index ${currentKeyIndex - 1} | Status: ${err.response?.status} | Msg:`, errMsg);
      }
    }

    console.error("[AI] All Gemini API keys exhausted or failed.");
    res.status(429).json({ error: "All AI keys are exhausted or invalid. Check Render logs." });

  } catch (err) {
    console.error("[AI ERROR]:", err.message);
    res.status(500).json({ error: "AI server error" });
  }
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