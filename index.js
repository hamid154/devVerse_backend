require("dotenv").config();
const express = require("express");
const app = express();
const mongoose = require("mongoose");
const cors = require("cors");
const fetch = require("node-fetch");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

app.use(express.json());
app.use(cors());

// =======================
// DB CONNECTION
// =======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log(err));

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
  res.send("this is server side");
});

// =======================
// SEND OTP (RESEND FIXED)
// =======================
app.post("/send-signup-otp", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ error: "Account already exists." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    await Otp.deleteMany({ email });
    await Otp.create({ email, otp: otpCode });

    await resend.emails.send({
      from: "DevVerse <onboarding@resend.dev>",
      to: "sonu808360@gmail.com", // 👈 पहले अपना email डाल
      subject: "Your OTP",
      html: `<h2>Your OTP: ${otpCode}</h2>`

    });

    return res.json({ message: "OTP_SENT" });

  } catch (err) {
    console.log("EMAIL ERROR:", err.message);
    res.status(500).json({ error: "Server error sending verification email." });
  }
});

// =======================
// VERIFY SIGNUP
// =======================
app.post("/verify-signup", async (req, res) => {
  const { name, email, password, otp } = req.body;

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

    res.json({ message: "User registered successfully" });

  } catch (err) {
    console.log(err);
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

    if (!user) {
      return res.status(404).json({ error: "Account not found" });
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

// =======================
// AI SYSTEM (UNCHANGED)
// =======================
let currentKeyIndex = 0;

app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  let responseText = null;
  let fallbackErrors = [];

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
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: prompt }
          ],
          temperature: 0.7
        })
      });

      if (dlResponse.ok) {
        const dlData = await dlResponse.json();
        return res.json({ text: dlData.choices[0].message.content });
      }
    } catch (err) {
      fallbackErrors.push("DeepSeek failed");
    }
  }

  const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
  ].filter(Boolean);

  try {
    for (let i = 0; i < keys.length; i++) {
      const key = keys[currentKeyIndex];
      currentKeyIndex = (currentKeyIndex + 1) % keys.length;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        }
      );

      if (response.ok) {
        const data = await response.json();
        return res.json({
          text: data.candidates?.[0]?.content?.parts?.[0]?.text || "No response"
        });
      }
    }

    res.status(429).json({ error: "All API keys exhausted" });

  } catch (err) {
    res.status(500).json({ error: "AI server error" });
  }
});

// =======================
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});