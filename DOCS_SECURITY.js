/**
 * DEVVERSE TOOLS - SECURITY IMPLEMENTATION OVERVIEW
 * 
 * This file is created for your reference to understand how the 
 * "Authentication & Security" logic works after the merge.
 */

// 1. PASSWORD HASHING (Found in models/User.js)
/*
UserSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt); // Hashes password before saving
    next();
});
*/

// 2. TOKEN GENERATION (Found in utils/authUtils.js)
/*
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};
*/

// 3. ROUTE PROTECTION (Found in middleware/authMiddleware.js)
/*
const protect = async (req, res, next) => {
    // Verifies the Bearer token in headers
    // Attaches the user to the request (req.user)
};
*/

// 4. LOGIN LOGIC (Found in server.js)
/*
app.post("/login", async (req, res) => {
    const user = await User.findOne({ email });
    if (user && (await user.comparePassword(password))) {
        // SUCCESS: Sends Token + User Info
    } else {
        // FAIL: Invalid credentials
    }
});
*/

console.log("Security implementation details are documented in this file and applied across the backend.");
