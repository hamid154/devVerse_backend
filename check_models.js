const axios = require('axios');
require('dotenv').config();

const keys = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4
].filter(Boolean);

async function checkModels() {
    for (const key of keys) {
        console.log(`\n--- Key: ${key.substring(0, 10)}... ---`);
        try {
            const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
            const models = response.data.models;
            if (!models) {
                console.log("No models returned.");
                continue;
            }
            models.forEach(m => {
                console.log(`- ${m.name}`);
            });
        } catch (err) {
            console.error(`Error: ${err.response?.status} - ${err.response?.data?.error?.message || err.message}`);
        }
    }
}

checkModels();
