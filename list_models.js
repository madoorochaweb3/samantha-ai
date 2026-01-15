require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function listModels() {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        // List models is not directly on genAI in some versions, it's on the client
        // But for @google/generative-ai it might be tricky.
        // Let's try the fetch approach to be sure.
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
        const data = await response.json();
        console.log("Modelos Disponíveis:");
        if (data.models) {
            data.models.forEach(m => console.log(`- ${m.name} (${m.displayName})`));
        } else {
            console.log(JSON.stringify(data, null, 2));
        }
    } catch (error) {
        console.error("Erro ao listar modelos:");
        console.error(error);
    }
}

listModels();
