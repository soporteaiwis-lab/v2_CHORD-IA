
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

  // 2. Isolate JSON Object
  const firstBrace = cleanText.indexOf('{');
  const lastBrace = cleanText.lastIndexOf('}');

  if (firstBrace !== -1 && lastBrace !== -1) {
    cleanText = cleanText.substring(firstBrace, lastBrace + 1);
  }

  // 3. Robust Parsing Strategy
  try {
    // Attempt 1: Direct Parse
    return JSON.parse(cleanText);
  } catch (e) {
    console.warn("Direct parse failed. Attempting repair...");
    
    try {
        // Attempt 2: Common Fixes
        let repaired = cleanText;
        
        // Fix: Quote unquoted keys (simple regex, safe for simple keys)
        repaired = repaired.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');
        
        // Fix: Remove trailing commas
        repaired = repaired.replace(/,(\s*[}\]])/g, '$1');

        // Fix: Replace NaN with null (JSON doesn't support NaN)
        repaired = repaired.replace(/:\s*NaN/g, ': null');

        return JSON.parse(repaired);
    } catch (e2) {
        console.error("JSON Repair Failed:", e2);
        console.log("Failed Text:", text);
        throw new Error("Analysis produced invalid data format.");
    }
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
  
  // Classic, stable prompt structure
  const prompt = `
    Analyze the following audio file (${formattedDuration}) and provide a harmonic analysis in valid JSON.

    REQUIREMENTS:
    1. BPM & Sync: Detect the BPM. Generate a chord progression that is synchronized with the audio time (seconds).
    2. Coverage: The chords array must cover the full duration from 0.0s to ${duration}s. Use "N.C." for silence.
    3. Output: Return ONLY the JSON object. No other text.

    JSON SCHEMA:
    {
      "title": "Track Title",
      "artist": "Artist Name",
      "key": "Key (e.g. Cm)",
      "bpm": 120,
      "timeSignature": "4/4",
      "complexityLevel": "Intermediate",
      "summary": "Short description of the harmony.",
      "sections": [
        { "name": "Intro", "startTime": 0.0, "endTime": 10.0, "color": "#475569" }
      ],
      "chords": [
        {
          "timestamp": "0:00",
          "seconds": 0.0,
          "duration": 2.0,
          "root": "C",
          "quality": "min",
          "extension": "7",
          "bass": "G",
          "symbol": "Cm7/G",
          "confidence": 1.0
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
      temperature: 0.3, // Balanced for creativity vs structure
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
    Analyze this URL: "${url}". Return valid JSON only.
    Schema:
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
