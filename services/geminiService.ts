
import { GoogleGenAI } from "@google/genai";
import { SongAnalysis } from "../types";

// Initialize the API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- CONFIGURATION ---
const MODEL_ID = "gemini-2.0-flash-exp"; 

// --- UTILS ---

const extractJSON = (text: string): any => {
  if (!text) return null;
  
  try {
    let cleanText = text.trim();

    // 1. Remove Markdown code blocks (```json ... ```)
    cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '');

    // 2. Find the outer-most JSON object brackets
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');

    if (firstBrace !== -1 && lastBrace !== -1) {
      // Extract ONLY the JSON part
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    } else {
      throw new Error("No JSON object found in response");
    }

    // 3. Simple cleanup engine for common LLM JSON errors
    // Fix: Ensure keys are quoted
    cleanText = cleanText.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
    // Fix: Remove trailing commas
    cleanText = cleanText.replace(/,(\s*[}\]])/g, '$1');

    return JSON.parse(cleanText);
  } catch (e) {
    console.error("JSON Parse Failed:", e);
    console.log("Raw Text:", text);
    throw new Error("Analysis produced invalid data format.");
  }
};

// --- RETRY LOGIC ---
const MAX_RETRIES = 3;
const BASE_DELAY = 2000;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function generateWithRetry(contents: any, config: any, retries = 0): Promise<any> {
  try {
    const result = await ai.models.generateContent({ model: MODEL_ID, contents, config });
    if (!result.text) {
      throw new Error("Model returned empty response");
    }
    return result;
  } catch (error: any) {
    console.error(`Attempt ${retries + 1} failed:`, error);
    if (retries < MAX_RETRIES) {
      await delay(BASE_DELAY * Math.pow(2, retries));
      return generateWithRetry(contents, config, retries + 1);
    }
    throw error;
  }
}

// --- MAIN ANALYSIS ---

export const analyzeAudioContent = async (base64Data: string, mimeType: string, duration: number): Promise<SongAnalysis> => {
  const formattedDuration = `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
  
  // Prompt optimized for Reliability + Musical Accuracy
  const prompt = `
    Role: Senior Music Theorist.
    Task: Analyze audio (${formattedDuration}) and return JSON.
    
    CRITICAL ANALYSIS RULES:
    1. **BPM & Time**: Detect precise BPM first. Ensure measures align.
    2. **Sync**: The chord progression MUST cover the entire file (0.00s to ${duration}s). Do not stop early.
    3. **Accuracy**: Use "N.C." for silence. Verify modulation key changes.
    
    STRICT OUTPUT FORMAT:
    - Output **ONLY** raw JSON. No markdown, no "Thinking:" text.
    - Keys must be double-quoted.
    - 'seconds' must be float.

    JSON STRUCTURE:
    {
      "title": "string",
      "artist": "string",
      "key": "string",
      "bpm": 120,
      "timeSignature": "4/4",
      "complexityLevel": "Intermediate",
      "summary": "string",
      "sections": [
        { "name": "Intro", "startTime": 0.0, "endTime": 10.0, "color": "#hex" }
      ],
      "chords": [
        {
          "timestamp": "0:00",
          "seconds": 0.0,
          "duration": 2.5,
          "root": "C",
          "quality": "min",
          "extension": "7",
          "bass": "Bb",
          "symbol": "Cm7/Bb",
          "confidence": 0.99
        }
      ]
    }
  `;

  try {
    const contents: any = { 
      parts: [
        { inlineData: { mimeType, data: base64Data } },
        { text: prompt } 
      ] 
    };

    const response = await generateWithRetry(contents, {
      responseMimeType: "application/json", 
      temperature: 0.2, // Slightly higher to allow musical creativity but low enough for structure
      maxOutputTokens: 8192,
    });

    const data = extractJSON(response.text);
    if (!data) throw new Error("Parsed data was null");
    return data;

  } catch (error: any) {
    throw new Error(error.message || "Analysis failed.");
  }
};

export const analyzeSongFromUrl = async (url: string): Promise<SongAnalysis> => {
  const prompt = `
    Role: Music Theorist. Analyze URL: "${url}".
    Return ONLY valid JSON.
    Structure:
    {
      "title": "string", "artist": "string", "key": "string", "bpm": number, "timeSignature": "string",
      "sections": [{ "name": "string", "startTime": number, "endTime": number }],
      "chords": [{ "timestamp": "string", "seconds": number, "duration": number, "root": "string", "quality": "string", "extension": "string", "bass": "string", "symbol": "string", "confidence": number }],
      "summary": "string", "complexityLevel": "string"
    }
  `;

  try {
    const contents = { parts: [{ text: prompt }] };
    const response = await generateWithRetry(contents, {
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
        maxOutputTokens: 8192,
    });
    return extractJSON(response.text);
  } catch (error: any) {
    throw new Error("Link analysis failed: " + error.message);
  }
};
