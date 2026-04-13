require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const axios = require("axios");
const User = require("./models/User");
const { generateToken } = require("./utils/authUtils");
const { protect } = require("./middleware/authMiddleware");

const app = express();
app.use(express.json());
app.use(cors());

// =======================
// DB CONNECTION
// =======================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected ✅"))
  .catch(err => console.log("MongoDB Connection Error ❌:", err));

// =======================
// DB STATUS TEST
// =======================
app.get("/test-db", async (req, res) => {
  try {
    const isConnected = mongoose.connection.readyState === 1;
    if (isConnected) {
      const count = await User.countDocuments();
      res.json({ 
        status: "Connected ✅", 
        database: "DevVerse", 
        collection: "mytools", 
        users: count 
      });
    } else {
      res.status(500).json({ status: "Disconnected ❌", state: mongoose.connection.readyState });
    }
  } catch (err) {
    res.status(500).json({ status: "Error ❌", message: err.message });
  }
});

// =======================
// AUTHENTICATION SYSTEM
// =======================

// 1. SIGNUP / REGISTER (Automatic Hashing via Model)
app.post(["/signup", "/register", "/send-signup-otp"], async (req, res) => {
  const { name, email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    
    // Check if user exists
    let user = await User.findOne({ email: normalizedEmail });
    
    if (user) {
        // Update existing user (Legacy logic from index.js)
        user.name = name || user.name;
        user.password = password; // Model hook will re-hash if modified
        await user.save();
        console.log(`[AUTH] User updated: ${normalizedEmail}`);
    } else {
        // Create new user
        user = new User({
            name: name || "User",
            email: normalizedEmail,
            password
        });
        await user.save();
        console.log(`[AUTH] New registration: ${normalizedEmail}`);
    }

    res.json({ 
        message: "User registered successfully", 
        user: { id: user._id, name: user.name, email: user.email },
        token: generateToken(user._id)
    });
  } catch (err) {
    console.error("[AUTH ERROR]:", err);
    // Returning actual error message for debugging
    res.status(500).json({ 
        error: "Server error during registration", 
        details: err.message,
        code: err.code 
    });
  }
});


// 2. SECURE LOGIN
app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: "Invalid credentials (Wrong email or password)" });
    }

    console.log(`[LOGIN] Success: ${email}`);
    res.json({ 
      message: "Login successful", 
      user: { id: user._id, name: user.name, email: user.email },
      token: generateToken(user._id)
    });
  } catch (err) {
    console.error("[LOGIN ERROR]:", err);
    res.status(500).json({ error: "Server error during login" });
  }
});

// =======================
// AI SYSTEM (DEEPSEEK)
// =======================
app.post("/ask-ai", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt required" });

  const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;

  if (!DEEPSEEK_KEY) {
    return res.status(500).json({ error: "DeepSeek API key not configured on server" });
  }

  try {
    const response = await axios.post(
      "https://api.deepseek.com/v1/chat/completions",
      {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are NEXUS AI, an advanced developer assistant for the DevVerse platform." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 2048
      },
      {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${DEEPSEEK_KEY}`
        }
      }
    );

    if (response.data && response.data.choices && response.data.choices[0]) {
      let text = response.data.choices[0].message.content;
      
      // Auto-clean Markdown JSON blocks for tools
      if (text.includes('```')) {
        text = text.replace(/```json/g, '').replace(/```JSON/g, '').replace(/```/g, '').trim();
      }
      
      return res.json({ text });
    }

    throw new Error("Invalid response from DeepSeek API");

  } catch (err) {
    console.error("[DEEPSEEK ERROR]:", err.response?.data || err.message);
    const errorMsg = err.response?.data?.error?.message || "AI logic failed. Please check your DeepSeek key and credits.";
    res.status(err.response?.status || 500).json({ error: errorMsg });
  }
});

// Protected route example
app.get("/me", protect, (req, res) => {
    res.json(req.user);
});

app.get("/", (req, res) => { 
    res.send("DevVerse Live 🚀 (Secure Auth & AI Integrated)"); 
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
