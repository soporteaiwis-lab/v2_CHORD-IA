
import { GoogleGenAI } from "@google/genai";
import { SongAnalysis } from "../types";

// Initialize the API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- CONFIGURATION ---
const MODEL_ID = "gemini-2.0-flash-exp"; 

// --- UTILS ---

const extractJSON = (text: string): any => {
  if (!text) return null;
  
  // 1. Basic Cleanup (Remove Markdown)
  let cleanText = text.trim();
  cleanText = cleanText.replace(/```json/g, '').replace(/```/g, '');

  // 2. Isolate JSON Object (Find outer braces)
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanText = cleanText.substring(firstBrace, lastBrace + 1);
  }

  // 3. ATTEMPT 1: Direct Parse (Most Reliable)
  try {
    return JSON.parse(cleanText);
  } catch (e) {
    console.warn("Direct parse failed. Attempting repair...");
  }

  // 4. ATTEMPT 2: Aggressive Repair (Fallback only)
  try {
    // Fix unquoted keys (e.g. { key: "value" } -> { "key": "value" })
    // We use a specific regex that tries to avoid matching text inside values
    // This looks for a key at the start of a line or after a comma/brace
    let repaired = cleanText.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
    
    // Fix trailing commas before closing braces
    repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
    
    return JSON.parse(repaired);
  } catch (e) {
    console.error("JSON Repair Failed:", e);
    console.log("Failed Text:", text);
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
  
  // Precise prompt asking for JSON only
  const prompt = `
    Role: Senior Music Theorist.
    Task: Analyze audio (${formattedDuration}) and return strictly formatted JSON.
    
    INSTRUCTIONS:
    1. **BPM & Grid**: Determine precise BPM. Ensure chord timestamps align perfectly with the grid.
    2. **Completeness**: The chords array MUST cover the audio from 0.0s to exactly ${duration}s. Use "N.C." for silence.
    3. **Accuracy**: Detect key changes (modulations) and complex extensions.
    
    OUTPUT FORMAT:
    - Return **ONLY** the JSON object. Do not include "Thinking" steps or markdown text outside the JSON.
    - Ensure all keys and string values are double-quoted.

    JSON STRUCTURE:
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "key": "C Minor",
      "bpm": 120,
      "timeSignature": "4/4",
      "complexityLevel": "Intermediate",
      "summary": "Brief harmonic description.",
      "sections": [
        { "name": "Intro", "startTime": 0.0, "endTime": 10.0, "color": "#475569" }
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
      temperature: 0.1, // Low temperature for consistent JSON structure
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
