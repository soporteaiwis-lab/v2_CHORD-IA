
import { GoogleGenAI } from "@google/genai";
import { SongAnalysis } from "../types";

// Initialize the API client
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- CONFIGURATION ---
// Gemini 2.0 Flash Exp is currently the best balance of speed/reasoning
const MODEL_ID = "gemini-2.0-flash-exp"; 

// --- ROBUST JSON REPAIR ENGINE ---
const repairMalformedJSON = (jsonString: string): string => {
  let fixed = jsonString.trim();

  // 1. Remove Markdown code blocks and any "Thinking" text pre-amble
  fixed = fixed.replace(/```json/g, '').replace(/```/g, '');
  
  // Isolate the JSON object if there's conversational text around it
  const firstBrace = fixed.indexOf('{');
  const lastBrace = fixed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    fixed = fixed.substring(firstBrace, lastBrace + 1);
  }

  // 2. Fix missing quotes on keys
  fixed = fixed.replace(/([{,]\s*)([a-zA-Z0-9_]+?)\s*:/g, '$1"$2":');

  // 3. Fix trailing commas
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');

  return fixed;
};

const extractJSON = (text: string): any => {
  if (!text) return null;
  
  try {
    // Attempt direct parse first
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
  // Format duration for context
  const formattedDuration = `${Math.floor(duration / 60)}:${Math.floor(duration % 60).toString().padStart(2, '0')}`;
  
  // DEEP ANALYSIS PROMPT
  // We force the AI to "think" about the grid structure before assigning chords.
  const prompt = `
    Role: World-Class Music Theorist & Audio Engineer.
    Task: Deep Harmonic Analysis of this audio file (${formattedDuration} total length).

    CRITICAL PROCESS (Follow these steps internally):
    1. **Listen for the Beat**: Determine the exact BPM and Time Signature first.
    2. **Construct the Grid**: Calculate how many measures exist based on duration & BPM.
    3. **Analyze Key**: Listen to the Bass and Melody interaction. Check specific frequencies. Verify the Key Center multiple times.
    4. **Assign Chords**: Map harmony to the time grid.
       - IMPORTANT: The 'chords' array MUST cover the audio from 0.00s to exactly ${duration}s. Do not stop early.
       - Use "N.C." for silence/noise.

    OUTPUT FORMAT RULES:
    1. Return **ONLY valid JSON**.
    2. 'seconds' must be precise floats (e.g. 12.435).
    3. 'symbol' should be the full chord (e.g., Cm7/Bb).

    JSON STRUCTURE:
    {
      "title": "Song Title",
      "artist": "Artist Name",
      "key": "C Minor",
      "bpm": 120,
      "timeSignature": "4/4",
      "complexityLevel": "Intermediate", 
      "summary": "Detailed harmonic description of progression, modulation, and cadence.",
      "sections": [
        { "name": "Intro", "startTime": 0.0, "endTime": 15.5, "color": "#475569" }
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
      temperature: 0.1, // Very low temperature for maximum precision and adherence to structure
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
    Role: Expert Music Theorist. Analyze the harmony of this URL: "${url}".
    
    REQUIREMENTS:
    1. Detect BPM and Key with high precision.
    2. Create a full chord chart from start to finish.
    3. Output valid JSON only.

    STRUCTURE:
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
