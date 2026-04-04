require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();
const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());

app.use(cors()); // Allow all origins to prevent connection issues

// Db connection
console.log("ENV CHECK:", process.env.MONGO_URI);
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.log("❌ MONGO_URI not found");
} else {
  mongoose.connect(MONGO_URI)
    .then(() => console.log("MongoDB Connected ✅"))
    .catch(err => console.log(err));
}


const userSchema = new mongoose.Schema({
  name: { type: String },
  email: { type: String, required: true },
  password: { type: String, required: true },
});
const User = mongoose.model("mytools", userSchema, "mytools");

const optSchema = new mongoose.Schema({
  email: { type: String, required: true },
  otp: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 300 } // Auto-delete in 5 min
});
const Otp = mongoose.model("Otp", optSchema);

// Nodemailer SMTP Transporter
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail", // 👈 IMPORTANT CHANGE
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
// ==========================================
// PRE-REGISTRATION OTP API (Step 1 of Signup)
// ==========================================
app.post("/send-signup-otp", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ error: "Account with this email already exists." });
    }

    if (!transporter) {
      return res.status(500).json({ error: "Backend missing EMAIL_USER or EMAIL_PASS in .env to send verification OTP." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP in database safely
    await Otp.deleteMany({ email });
    await Otp.create({ email, otp: otpCode });

    const mailOptions = {
      from: `"DevVerse Verification" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your DevVerse Account",
      html: `
            <div style="font-family: sans-serif; text-align: center; color: #1e293b; padding: 20px;">
                <h1 style="color: #6366f1;">Welcome to DevVerse 🚀</h1>
                <p>Hello ${name},</p>
                <p>We're thrilled you're joining us. Please verify your email to create your account:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #10b981; background: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 8px; display: inline-block; margin: 10px 0;">
                    ${otpCode}
                </div>
                <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">Secure code expires in 5 minutes.</p>
            </div>
        `
    };

    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "Verify Your Account",
      html: `<h2>Your OTP: ${otpCode}</h2>`
    });
    return res.json({ message: "OTP_SENT" });

  } catch (err) {
    console.log("EMAIL ERROR:", err.message); // 👈 MUST
    res.status(500).json({ error: "Server error sending verification email." });


  }
});

// ==========================================
// VERIFY SIGNUP API (Step 2 of Signup)
// ==========================================
app.post("/verify-signup", async (req, res) => {
  const { name, email, password, otp } = req.body;
  try {
    const record = await Otp.findOne({ email });

    if (!record) {
      return res.status(400).json({ error: "Verification code expired. Please request a new one." });
    }

    if (record.otp !== otp) {
      return res.status(400).json({ error: "Incorrect verification code." });
    }

    // Code matches! Destroy OTP and finalize account registration securely.
    await Otp.deleteMany({ email });
    const newUser = new User({ name, email, password });
    await newUser.save();

    res.json({ message: "User registered successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error finalizing registration." });
  }
});

// ==========================================
// STANDARD LOGIN API (Instant Access)
// ==========================================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "Account not found. Please create an account first." });
    }
    if (user.password !== password) {
      return res.json({ message: "Wrong password" });
    }
    res.json({ message: "Login successful", name: user.name });
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Global Key Index Memory for Round Robin load balancing
let currentKeyIndex = 0;

// ASK AI API (Secure Backend Execution with Smart Round Robin & Auto-Retry)
app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  let responseText = null;
  let fallbackErrors = [];

  // ==========================================
  // PRIORITY 1: DEEPSEEK API (If provided)
  // ==========================================
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  if (deepseekKey) {
    try {
      const dlResponse = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deepseekKey}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "You are a helpful expert assistant. You must output only raw valid JSON if requested, without markdown code blocks." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7
        })
      });

      if (dlResponse.ok) {
        const dlData = await dlResponse.json();
        responseText = dlData.choices[0].message.content;
        return res.json({ text: responseText });
      } else {
        const payload = await dlResponse.text();
        console.warn(`DeepSeek API Failed (${dlResponse.status}): ${payload}. Falling back to Gemini...`);
        fallbackErrors.push(`DeepSeek failed (${dlResponse.status})`);
      }
    } catch (err) {
      console.error(`DeepSeek Network Error: ${err.message}. Falling back to Gemini...`);
      fallbackErrors.push(`DeepSeek network error`);
    }
  }

  // ==========================================
  // PRIORITY 2: GEMINI ROUND ROBIN FALLBACK
  // ==========================================
  // Gather all available API keys from .env
  const keys = [
    process.env.GEMINI_API_KEY,   // Original Key 1
    process.env.GEMINI_API_KEY_2, // Key 2
    process.env.GEMINI_API_KEY_3, // Key 3
    process.env.GEMINI_API_KEY_4  // Key 4
  ].filter(Boolean); // removes undefined/empty

  if (keys.length === 0 && !deepseekKey) {
    return res.status(500).json({ error: "Server error: No API Keys (Gemini or DeepSeek) found in backend/.env" });
  }

  try {
    // Try keys sequentially up to the total number of keys
    for (let attempts = 0; attempts < keys.length; attempts++) {
      const activeKey = keys[currentKeyIndex];

      // Point index to the next key for the *next* request (Round Robin balance)
      const currentAttemptIndex = currentKeyIndex;
      currentKeyIndex = (currentKeyIndex + 1) % keys.length;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(activeKey)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        const content = data.candidates?.[0]?.content;
        responseText = content?.parts?.[0]?.text || content?.[0]?.text || "No AI response";
        break; // Success! Break out of the retry loop.
      } else if (response.status === 429) {
        // Rate Limit Hit on this key. Log and let loop try the next key immediately!
        console.warn(`⚠️ Rate limit hit on Key ${currentAttemptIndex + 1}. Auto-switching to next fallback key...`);
        fallbackErrors.push(`Key ${currentAttemptIndex + 1} blocked (429)`);
        continue;
      } else {
        // Other fatal errors (e.g. invalid key format)
        const payload = await response.text();
        console.error(`Fatal AI Error on Key ${currentAttemptIndex + 1}: ${payload}`);
        fallbackErrors.push(`Key ${currentAttemptIndex + 1} failed (${response.status})`);
        continue;
      }
    }

    if (responseText) {
      return res.json({ text: responseText });
    } else {
      // If we reach here, ALL keys were exhausted or failed.
      return res.status(429).json({
        error: `AI Error: All ${keys.length} API keys are currently completely exhausted or rate-limited. Please wait 1 minute. Details: ${fallbackErrors.join(', ')}`
      });
    }

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Server error connecting to AI engine network." });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});