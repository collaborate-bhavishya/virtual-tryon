import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { GoogleGenAI, RawReferenceImage, MaskReferenceImage } from '@google/genai';
import dotenv from 'dotenv';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, 'settings.json');

function readSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch (err) {
    console.error("Failed to read settings.json:", err);
  }
  return {
    maxGenerationsPerDay: 50,
    generationsToday: 0,
    lastResetDate: "",
    promptTemplate: "A professional photograph of the exact same person from the reference image, but they are wearing: {{garmentDescription}}. Keep the person's face, features, hair, skin tone, body shape, pose, expression, and the background completely identical."
  };
}

function writeSettings(settings) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error("Failed to write settings.json:", err);
  }
}

function checkAndResetDailyCounter() {
  const settings = readSettings();
  const todayStr = new Date().toISOString().split('T')[0];
  if (settings.lastResetDate !== todayStr) {
    settings.generationsToday = 0;
    settings.lastResetDate = todayStr;
    writeSettings(settings);
  }
  return settings;
}

const app = express();
const port = process.env.PORT || 5001;

const isVertex = process.env.VERTEX_AI === 'true';
// Default to capability model on Vertex AI for inpainting support, otherwise generate model
const defaultModel = isVertex ? 'imagen-3.0-capability-001' : 'imagen-4.0-generate-001';
const imagenModel = process.env.IMAGEN_MODEL || defaultModel;

let ai;

try {
  if (isVertex) {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    const location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';
    console.log(`[Vertex AI] Initializing client... Project: "${project}", Location: "${location}", Model: "${imagenModel}"`);
    ai = new GoogleGenAI({
      vertexai: true,
      project: project,
      location: location,
    });
  } else {
    const apiKey = process.env.GEMINI_API_KEY;
    console.log(`[AI Studio] Initializing client... Key configured: ${!!apiKey}, Model: "${imagenModel}"`);
    ai = new GoogleGenAI({ apiKey });
  }
} catch (initError) {
  console.error("Critical Error during GoogleGenAI client initialization:", initError);
}

// Enable CORS for frontend requests
app.use(cors());
app.use(express.json());

// Set up Multer to store uploaded files in memory
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Endpoint to check status / list available models
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: isVertex ? 'Vertex AI' : 'AI Studio',
    apiKeyConfigured: isVertex ? 'N/A (Uses GCP IAM)' : !!process.env.GEMINI_API_KEY,
    project: process.env.GOOGLE_CLOUD_PROJECT || null,
    location: process.env.GOOGLE_CLOUD_LOCATION || null,
    imagenModel: imagenModel,
  });
});

// Core Virtual Try-On endpoint
app.post('/api/try-on', upload.fields([
  { name: 'model', maxCount: 1 },
  { name: 'cloth', maxCount: 1 }
]), async (req, res) => {
  try {
    const settings = checkAndResetDailyCounter();
    if (settings.generationsToday >= settings.maxGenerationsPerDay) {
      return res.status(429).json({
        error: `Daily generation limit of ${settings.maxGenerationsPerDay} images reached. Please contact your administrator.`
      });
    }

    if (!isVertex && !process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error: 'GEMINI_API_KEY is not configured on the server. Please add it to your .env file or enable Vertex AI mode.'
      });
    }

    if (!req.files || !req.files['model'] || !req.files['cloth']) {
      return res.status(400).json({
        error: 'Please upload both a model image and a clothing image.'
      });
    }

    const modelFile = req.files['model'][0];
    const clothFile = req.files['cloth'][0];
    const aspectRatio = req.body.aspectRatio || '3:4';
    const customInstruction = req.body.customInstruction || '';

    console.log('--- Virtual Try-On Request Received ---');
    console.log(`Mode: ${isVertex ? 'Vertex AI' : 'AI Studio'}`);
    console.log(`Model image: ${modelFile.originalname} (${modelFile.mimetype}, ${modelFile.size} bytes)`);
    console.log(`Cloth image: ${clothFile.originalname} (${clothFile.mimetype}, ${clothFile.size} bytes)`);
    console.log(`Aspect ratio: ${aspectRatio}`);
    if (customInstruction) console.log(`Custom instructions: "${customInstruction}"`);

    // CASE 1: Vertex AI - Virtual Try-On (VTO) using recontextImage
    if (isVertex) {
      console.log('Executing Vertex AI Virtual Try-On (recontextImage VTO)...');
      
      // Step 1: Describe the garment using gemini-2.5-flash for details in UI
      console.log('Step 1: Asking gemini-2.5-flash to describe the garment...');
      const geminiPrompt = `
You are an expert fashion coordinator. 
Analyze the garment in this image. Write a highly detailed description of the garment, including its type (e.g. shirt, t-shirt, dress, jacket, pants), color, pattern, material texture, and design details (collar, buttons, sleeves, pockets).
Do not include any introductory or concluding text. Return ONLY the description itself.
`;
      const clothPart = {
        inlineData: {
          mimeType: clothFile.mimetype,
          data: clothFile.buffer.toString('base64'),
        },
      };

      let garmentDescription = "Virtual Try-On Model ('virtual-try-on-001')";
      let geminiUsage = null;
      try {
        const promptResponse = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [clothPart, geminiPrompt],
        });
        if (promptResponse.text) {
          garmentDescription = promptResponse.text.trim();
        }
        if (promptResponse.usageMetadata) {
          geminiUsage = {
            promptTokens: promptResponse.usageMetadata.promptTokenCount,
            candidatesTokens: promptResponse.usageMetadata.candidatesTokenCount,
            totalTokens: promptResponse.usageMetadata.totalTokenCount
          };
        }
      } catch (geminiErr) {
        console.warn('Non-critical: Gemini was unable to describe the clothing item:', geminiErr.message || geminiErr);
      }
      console.log(`Garment Description: "${garmentDescription}"`);

      // Step 2: Call recontextImage on Vertex AI VTO
      console.log(`Step 2: Calling recontextImage on Vertex AI (virtual-try-on-001)`);
      
      let generatedImageBase64 = null;
      let errorDetails = null;

      try {
        const vtoResponse = await ai.models.recontextImage({
          model: 'virtual-try-on-001',
          source: {
            personImage: {
              imageBytes: modelFile.buffer.toString('base64'),
              mimeType: modelFile.mimetype
            },
            productImages: [
              {
                productImage: {
                  imageBytes: clothFile.buffer.toString('base64'),
                  mimeType: clothFile.mimetype
                }
              }
            ]
          },
          config: {
            personGeneration: 'ALLOW_ALL'
          }
        });

        if (vtoResponse.generatedImages && vtoResponse.generatedImages.length > 0) {
          generatedImageBase64 = vtoResponse.generatedImages[0].image.imageBytes;
          console.log('Virtual Try-On generated successfully.');
        } else {
          throw new Error('No images returned from Virtual Try-On API.');
        }
      } catch (vtoError) {
        console.error('Error in recontextImage:', vtoError);
        errorDetails = vtoError.message || vtoError;
        return res.status(502).json({
          error: 'Failed to generate try-on image using Vertex AI Virtual Try-On model.',
          details: errorDetails,
          generatedPrompt: garmentDescription
        });
      }

      const geminiCost = geminiUsage ? 
        ((geminiUsage.promptTokens * 0.075 / 1000000) + (geminiUsage.candidatesTokens * 0.30 / 1000000)) : 0;
      const vtoCost = 0.06; // $0.06 per generated VTO image
      const totalCost = vtoCost + geminiCost;

      // Increment daily generations counter
      settings.generationsToday += 1;
      writeSettings(settings);

      return res.json({
        success: true,
        generatedPrompt: `Direct Image-to-Image Virtual Try-On.\n\nGarment detected:\n${garmentDescription}`,
        image: `data:image/jpeg;base64,${generatedImageBase64}`,
        usage: {
          geminiTokens: geminiUsage,
          modelUsed: 'virtual-try-on-001',
          imageGenerationCost: vtoCost,
          approxTotalCost: totalCost
        }
      });
    }

    // CASE 2: Google AI Studio - Text-Guided Prompt recreation (Fallback)
    console.log('Executing prompt-recreation pipeline (AI Studio)...');
    
    const geminiPrompt = `
You are a highly advanced fashion AI coordinator. 
Analyze the two images provided:
- Image 1 (Model): A person. Observe their exact facial features, pose, skin tone, hair color/style, body shape, and background.
- Image 2 (Cloth): A clothing item. Observe its type (e.g. shirt, dress, jacket), color, pattern, material texture, and design details.

Your task is to write a detailed, highly descriptive prompt for an image generator (like Imagen 3) to create a photo of the EXACT SAME person from Image 1 wearing the EXACT SAME clothing item from Image 2.

In your description, make sure to:
1. Describe the person in detail, ensuring they have the exact same identity, face, expression, hair, and body pose as in Image 1.
2. Describe the clothing item in detail, ensuring its exact patterns, colors, fabrics, fit, and style are applied to the person's body.
3. Describe the scene's setting, background, and lighting, matching them exactly to Image 1.
4. Maintain a professional fashion photography look.
${customInstruction ? `5. Additional style/instruction: ${customInstruction}` : ''}

Do NOT include any introductory or concluding text. Write ONLY the final image generation prompt itself.
`;

    const modelPart = {
      inlineData: {
        mimeType: modelFile.mimetype,
        data: modelFile.buffer.toString('base64'),
      },
    };

    const clothPart = {
      inlineData: {
        mimeType: clothFile.mimetype,
        data: clothFile.buffer.toString('base64'),
      },
    };

    let geminiUsage = null;
    const promptResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        modelPart,
        clothPart,
        geminiPrompt,
      ],
    });

    const generatedPrompt = promptResponse.text ? promptResponse.text.trim() : '';
    if (promptResponse.usageMetadata) {
      geminiUsage = {
        promptTokens: promptResponse.usageMetadata.promptTokenCount,
        candidatesTokens: promptResponse.usageMetadata.candidatesTokenCount,
        totalTokens: promptResponse.usageMetadata.totalTokenCount
      };
    }
    
    if (!generatedPrompt) {
      throw new Error('Gemini was unable to generate a prompt describing the try-on.');
    }

    console.log(`Generated Prompt:\n"${generatedPrompt}"\n`);

    // Step 2: Use the generated prompt to create the image via Imagen
    console.log(`Generating try-on image with ${imagenModel}...`);
    
    let generatedImageBase64 = null;
    let errorDetails = null;

    try {
      const imageResponse = await ai.models.generateImages({
        model: imagenModel,
        prompt: generatedPrompt,
        config: {
          numberOfImages: 1,
          outputMimeType: 'image/jpeg',
          aspectRatio: aspectRatio,
          personGeneration: 'ALLOW_ALL',
        },
      });

      if (imageResponse.generatedImages && imageResponse.generatedImages.length > 0) {
        generatedImageBase64 = imageResponse.generatedImages[0].image.imageBytes;
        console.log('Image generated successfully.');
      } else {
        throw new Error('No images returned from Imagen API.');
      }
    } catch (imagenError) {
      console.error('Error generating image with Imagen:', imagenError);
      errorDetails = imagenError.message || imagenError;
      
      // We will still return the generated prompt so the frontend can display it
      return res.status(502).json({
        error: `Failed to generate try-on image using ${imagenModel}.`,
        details: errorDetails,
        generatedPrompt: generatedPrompt
      });
    }

    const geminiCost = geminiUsage ? 
      ((geminiUsage.promptTokens * 0.075 / 1000000) + (geminiUsage.candidatesTokens * 0.30 / 1000000)) : 0;
    const imageCost = 0.03; // ~ $0.03 per image for standard Imagen 3
    const totalCost = imageCost + geminiCost;

    // Increment daily generations counter
    settings.generationsToday += 1;
    writeSettings(settings);

    // Return the result
    res.json({
      success: true,
      generatedPrompt: generatedPrompt,
      image: `data:image/jpeg;base64,${generatedImageBase64}`,
      usage: {
        geminiTokens: geminiUsage,
        modelUsed: imagenModel,
        imageGenerationCost: imageCost,
        approxTotalCost: totalCost
      }
    });

  } catch (error) {
    console.error('General Error in /api/try-on:', error);
    res.status(500).json({
      error: 'An internal server error occurred while processing the request.',
      details: error.message || error,
    });
  }
});

// Admin Panel endpoints
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'Zunoapp@2026';

app.get('/api/admin/settings', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${ADMIN_PASSCODE}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const settings = checkAndResetDailyCounter();
  res.json(settings);
});

app.post('/api/admin/settings', (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${ADMIN_PASSCODE}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { maxGenerationsPerDay, promptTemplate, resetCounter } = req.body;
  const settings = readSettings();
  if (maxGenerationsPerDay !== undefined) {
    settings.maxGenerationsPerDay = Number(maxGenerationsPerDay);
  }
  if (promptTemplate !== undefined) {
    settings.promptTemplate = promptTemplate;
  }
  if (resetCounter === true) {
    settings.generationsToday = 0;
  }
  writeSettings(settings);
  res.json({ success: true, settings });
});

app.listen(port, () => {
  console.log(`Virtual Try-On Backend is running on http://localhost:${port}`);
});
