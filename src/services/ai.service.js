
const { GoogleGenAI } = require("@google/genai")

const ai = new GoogleGenAI()

async function generateResponse(content) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: content,
    });

    return response.text;
  } catch (error) {
    console.error("Gemini API Error:", error.message);
    throw new Error("AI service temporarily unavailable. Please try again.");
  }
}

module.exports = {
    generateResponse
}
