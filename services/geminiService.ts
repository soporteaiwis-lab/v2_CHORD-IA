
import { GoogleGenAI } from "@google/genai";
import { SongAnalysis } from "../types";

// Initialize the API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- CONFIGURATION ---
// Gemini 2.0 Flash is the fastest and most intelligent model for this task currently available.
const MODEL_ID = "gemini-2.0-flash-exp"; 

// --- ROBUST JSON REPAIR ENGINE ---
const repairMalformedJSON = (jsonString: string): string => {
  let fixed = jsonString.trim();

  // 1. Remove Markdown code blocks
  fixed = fixed.replace(/```json/g, '').replace(/```/g, '');

  // 2. Locate the main JSON object
  const firstBrace = fixed.indexOf('{');
  const lastBrace = fixed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    fixed = fixed.substring(firstBrace, lastBrace + 1);
  }

  // 3. Fix: Add double quotes to keys that don't have them
  // Matches "key:" or " key:" and replaces with ""key":"
  // This Regex looks for alphanumeric keys followed by a colon that are NOT already in quotes
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');

  // 4. Fix: Remove trailing commas before closing braces/brackets
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  // 5. Fix: Convert single quotes to double quotes for values
  // Warning: This is a heuristic and might affect content with apostrophes, 
  // but strict music data usually doesn't have complex text.
  // fixed = fixed.replace(/'/g, '"'); // Optional, use with caution

  return fixed;
};

const extractJSON = (text: string): any => {
  if (!text) return null;
  
  try {
    // First attempt: Direct parse (fastest)
    let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
        cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
    return JSON.parse(cleanText);
  } catch (e) {
    console.warn("Direct JSON parse failed. Attempting repair engine...");
    try {
        // Second attempt: Repair Engine
        const repaired = repairMalformedJSON(text);
        return JSON.parse(repaired);
    } catch (e2) {
        console.error("Repair failed. Raw text:", text);
        throw new Error("Analysis produced invalid data format. Please try again.");
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
  
  const prompt = `
    Role: Virtuoso Music Theorist.
    Task: Analyze this audio (${formattedDuration}) and return a detailed harmonic JSON.

    INSTRUCTIONS:
    1. **Format**: Return ONLY valid JSON. Ensure all property names are in double quotes.
    2. **Precision**: 'seconds' must be exact floats (e.g., 12.45). Sync must be perfect.
    3. **Content**:
       - 'symbol': The full chord name (e.g., Cm7/Bb).
       - 'confidence': 0.0 to 1.0 (estimate certainty).
       - 'sections': Break down Intro, Verse, Chorus, etc.

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
        { "name": "Intro", "startTime": 0.0, "endTime": 8.0, "color": "#475569" }
      ],
      "chords": [
        {
          "timestamp": "0:00",
          "seconds": 0.0,
          "duration": 2.0,
          "root": "C",
          "quality": "min",
          "extension": "7",
          "bass": "Bb",
          "symbol": "Cm7/Bb",
          "confidence": 0.98
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
      temperature: 0.2, // Low temperature for consistent formatting
      maxOutputTokens: 8192,
    });

    const data = extractJSON(response.text);
    if (!data) throw new Error("Parsed data was null");
    return data;

  } catch (error: any) {
    console.error("Analysis Error:", error);
    throw new Error(error.message || "Analysis failed.");
  }
};

export const analyzeSongFromUrl = async (url: string): Promise<SongAnalysis> => {
  const prompt = `
    Role: Music Theorist. Analyze URL: "${url}".
    Return ONLY valid JSON with this structure:
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
