const jwt = require('jsonwebtoken');

/**
 * Generate a JWT token for a user
 * @param {string} id - The user ID
 * @returns {string} - The generated JWT token
 */
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET || 'devverse_secret_key_123', {
        expiresIn: '30d',
    });
};

module.exports = {
    generateToken,
};
