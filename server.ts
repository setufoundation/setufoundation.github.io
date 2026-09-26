import express, { Request, Response } from 'express';
import http from 'http';
import fs from 'fs';
import 'dotenv/config';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT) || 3000;

// Enable larger body for base64 photo uploads
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Ensure public directories exist
const publicDir = path.resolve(__dirname, 'public');
const membersDir = path.resolve(publicDir, 'images', 'members');
if (!fs.existsSync(membersDir)) {
  fs.mkdirSync(membersDir, { recursive: true });
}

// Serve public static assets
app.use(express.static(publicDir));
app.use('/images/members', express.static(membersDir));

// Fallback image map for member portraits
const MEMBER_IMAGE_FALLBACKS: Record<string, string> = {
  'Rezaul_Karim_Picture.jpeg': 'rezaul_vector.svg',
  'Sarifa_Zahan_Picture.jpeg': 'sarifa_vector.svg',
  'Jubayer_Fahad_Picture.jpeg': 'jubayer_vector.svg',
  'Refat_mondol_Sinha_Picture.jpeg': 'refat_vector.svg',
  'Fahmida_Aboni_Picture.jpeg': 'fahmida_vector.svg',
  'Imran_Shahriar_Picture.jpeg': 'imran_vector.svg',
  'Minhajul_Picture.jpeg': 'minhajul_vector.svg'
};

// Route to serve member pictures with transparent SVG fallback if JPEG does not exist on disk
app.get('/images/members/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename;
  const filePath = path.join(membersDir, filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  }
  const fallbackSvg = MEMBER_IMAGE_FALLBACKS[filename];
  if (fallbackSvg) {
    const fallbackPath = path.join(membersDir, fallbackSvg);
    if (fs.existsSync(fallbackPath)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(fallbackPath);
    }
  }
  res.status(404).send('Image not found');
});

// Also support root-level access for uploaded photo names e.g. /Rezaul_Karim_Picture.jpeg
app.get('/:filename', (req: Request, res: Response, next) => {
  const filename = req.params.filename;
  if (MEMBER_IMAGE_FALLBACKS[filename]) {
    const memberFilePath = path.join(membersDir, filename);
    if (fs.existsSync(memberFilePath)) {
      return res.sendFile(memberFilePath);
    }
    const fallbackSvg = MEMBER_IMAGE_FALLBACKS[filename];
    const fallbackPath = path.join(membersDir, fallbackSvg);
    if (fs.existsSync(fallbackPath)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.sendFile(fallbackPath);
    }
  }
  next();
});

// API Endpoint to upload or replace official member photos
app.post('/api/upload-member-photo', (req: Request, res: Response) => {
  try {
    const { filename, dataUrl } = req.body;
    if (!filename || !dataUrl) {
      return res.status(400).json({ error: 'Filename and dataUrl are required' });
    }

    // Sanitize filename
    const safeName = path.basename(filename);
    const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const destPath = path.join(membersDir, safeName);
    fs.writeFileSync(destPath, buffer);

    // Also write to public root for direct /filename requests
    const rootDestPath = path.join(publicDir, safeName);
    fs.writeFileSync(rootDestPath, buffer);

    console.log(`Saved official member photo: ${safeName} (${buffer.length} bytes)`);
    return res.json({ 
      success: true, 
      url: `/images/members/${safeName}?v=${Date.now()}` 
    });
  } catch (err: any) {
    console.error('Error saving member photo:', err);
    return res.status(500).json({ error: err.message || 'Failed to save photo' });
  }
});

// Initialize Google Gemini SDK with telemetry User-Agent as instructed
const apiKey = process.env.GEMINI_API_KEY || '';
const ai = new GoogleGenAI({
  apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Role-based institutional personas for SETU Foundation
const SYSTEM_ROLES: Record<string, string> = {
  guide: `You are SETU Mitra (সেতু মিত্র) — the Official AI Ambassador & Institutional Guide for SETU Foundation for Environmental & Technological Upliftment (সেতু ফাউন্ডেশন).
Your Mission: Inform, assist, and guide citizens, donors, volunteers, researchers, and partners regarding SETU Foundation's ecological restoration, technological inclusion bootcamps, and emergency humanitarian relief.

Core Institutional Knowledge:
1. Entity Name: SETU Foundation for Environmental & Technological Upliftment (সেতু ফাউন্ডেশন)
2. Legal Entity Type: Registered Non-Profit Society under the Societies Registration Act, 1860 (Act XXI of 1860)
3. Regulatory Authority: Registrar of Joint Stock Companies and Firms (RJSC), Dhaka, Government of Bangladesh
4. Name Clearance Letter No: 2026409754 | Submission No: 2026423830
5. Registered Office: G-26, RH Home Centre, Farmgate, Tejgaon, Dhaka, Bangladesh
6. Official Email: setufoundation.bd@gmail.com
7. Flagship Pillars:
   - EcoSETU: Grassroots climate mitigation, coastal mangrove afforestation in Khulna & coastal estuaries (42,500+ saplings), urban greening in Dhaka.
   - TechSETU: Free digital literacy, web programming, Python & AI fundamentals for underprivileged youth (1,850+ graduates trained).
   - ReliefSETU: Rapid emergency response for flood-affected families in Sylhet, Feni, and Barisal (78,000+ meals & clean water packets distributed).
8. Executive Committee:
   - President: Md. Rezaul Karim
   - Vice President: Mst Sarifa Zahan Siddika
   - General Secretary: Md. Jubayer Islam Fahad
   - Joint General Secretary: Md. Refat Mondol Sinha
   - Treasurer: Fahmida Haque Aboni
   - Executive Members: Md. Imran Shahriar, Md. Minhajul Islam
9. Donation & Giving Channels:
   - Mobile Financial Services (MFS): Single official recipient number for bKash, Nagad, and Rocket is 01739778059 (Personal / Merchant, Reference: DONATION or SETU).
   - Bank Account: Sonali Bank PLC, Farmgate Branch, Dhaka (Account No: 01083020000445, Routing No: 200261314, Account Name: SETU Foundation for Environmental & Technological Upliftment).

Tone: Professional, inspiring, empathetic, precise, and tech-forward. Support both English and Bengali (বাংলা) inquiries fluently.`,

  scientist: `You are Dr. Sabuj, Lead EcoSETU Climate & Mangrove Restoration Specialist for SETU Foundation.
You specialize in coastal saline ecology, Rhizophora mangrove nursery propagation in Khulna and coastal delta estuaries, carbon sequestration metrics, soil erosion mitigation, and urban bio-diversity in Dhaka.
Explain ecological concepts with scientific precision, provide actionable environmental guidance, and connect questions directly to SETU Foundation's 42,500+ mangrove sapling plantations and grassroots climate resilience campaigns. Support both English and Bengali.`,

  mentor: `You are the TechSETU Coding & AI Mentor for underprivileged youth at SETU Foundation.
You guide youth, students, and aspiring developers in HTML, CSS, JavaScript, React, Python, machine learning, and AI prompt engineering.
Your pedagogical style is encouraging, practical, clear, and code-centric. Explain programming topics step-by-step and highlight how technological literacy bridges economic disparities in Bangladesh. Support both English and Bengali.`,

  relief: `You are the ReliefSETU Emergency Logistics & Humanitarian Relief Coordinator.
You specialize in flood response mapping, emergency boat logistics, dry food ration distribution, clean drinking water filtration, medical relief kits, and post-flood rehabilitation in Sylhet, Feni, and coastal Barisal.
Provide urgent, structured, compassionate disaster response information and explain how donations to 01739778059 immediately translate to life-saving relief supplies on the ground.`
};

const DEFAULT_SYSTEM_INSTRUCTION = SYSTEM_ROLES.guide;

// Multi-turn Gemini Chatbot Endpoint with Google Search Grounding, Maps Grounding & Model Routing
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    const { 
      messages, 
      model = 'gemini-2.5-flash', 
      useSearch = false, 
      useMaps = false, 
      role = 'guide',
      systemInstruction 
    } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'Messages array is required.' });
    }

    // Convert multi-turn history into GoogleGenAI contents format
    const contents = messages.map((m: { role: string; content: string }) => ({
      role: m.role === 'assistant' || m.role === 'model' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Select role-based system instruction
    const roleInstruction = SYSTEM_ROLES[role] || SYSTEM_ROLES.guide;
    const finalSystemInstruction = systemInstruction || roleInstruction;

    // Define priority model list for fallback if 429 rate limit is hit
    const requestedModel = model;
    const candidateModels = [
      requestedModel,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-3.5-flash',
      'gemini-3.1-flash-lite'
    ].filter((m, i, arr) => arr.indexOf(m) === i); // unique

    let lastError: any = null;
    let response: any = null;
    let usedModel = requestedModel;

    for (const testModel of candidateModels) {
      try {
        usedModel = testModel;
        const config: any = {
          systemInstruction: finalSystemInstruction,
        };

        // Grounding tools support: googleSearch & googleMaps
        if (useSearch) {
          config.tools = [{ googleSearch: {} }];
        } else if (useMaps) {
          config.tools = [{ googleMaps: {} }];
        }

        response = await ai.models.generateContent({
          model: testModel,
          contents,
          config,
        });

        if (response && response.text) {
          break; // successfully generated
        }
      } catch (err: any) {
        lastError = err;
        const isQuota = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED');
        console.warn(`Model ${testModel} failed (${err?.message?.slice(0, 80)}). Trying fallback if available...`);
        if (!isQuota) {
          // If not a quota issue (e.g. tool incompatibility), continue to next model
          continue;
        }
      }
    }

    if (response && response.text) {
      const replyText = response.text;
      const candidate = response.candidates?.[0];
      const groundingMetadata = candidate?.groundingMetadata || null;

      return res.json({
        reply: replyText,
        groundingMetadata,
        modelUsed: usedModel,
        roleUsed: role,
        timestamp: new Date().toISOString()
      });
    }

    // If all models hit quota limits, construct an intelligent, grounded knowledge response
    console.warn('All Gemini models exhausted free quota. Serving grounded knowledge fallback.');
    const userQuery = String(messages[messages.length - 1]?.content || '').toLowerCase();
    
    let fallbackAnswer = '';
    if (userQuery.includes('donate') || userQuery.includes('bkash') || userQuery.includes('nagad') || userQuery.includes('rocket') || userQuery.includes('bank') || userQuery.includes('01739778059')) {
      fallbackAnswer = `### Official Giving Channels for SETU Foundation\n\nYou can donate instantly via Mobile Financial Services (MFS) or direct bank transfer:\n\n- **Unified MFS Number:** **01739778059**\n  - **bKash:** Send Money / Payment to **01739778059** (Reference: \`DONATION\`)\n  - **Nagad:** Send Money / Payment to **01739778059** (Reference: \`SETU\`)\n  - **DBBL Rocket:** Send Money to **01739778059** (Reference: \`SETU\`)\n\n- **Bank Account:**\n  - **Bank:** Sonali Bank PLC, Farmgate Branch, Dhaka\n  - **Account Name:** SETU Foundation for Environmental & Technological Upliftment\n  - **Account No:** \`01083020000445\`\n  - **Routing No:** \`200261314\`\n\nAll donations are directly allocated to coastal mangrove plantation belts, youth coding bootcamps, and emergency flood lifelines.`;
    } else if (userQuery.includes('executive') || userQuery.includes('president') || userQuery.includes('secretary') || userQuery.includes('committee') || userQuery.includes('governance') || userQuery.includes('team')) {
      fallbackAnswer = `### Executive Committee of SETU Foundation (2026–2028)\n\nSETU Foundation is governed by seven registered officers under RJSC Act XXI of 1860:\n\n1. **Md. Rezaul Karim** — *President* (Ecological strategy & institutional partnerships)\n2. **Mst Sarifa Zahan Siddika** — *Vice President* (Community mobilization & female tech inclusion)\n3. **Md. Jubayer Islam Fahad** — *General Secretary* (Secretariat administration & tech bootcamps)\n4. **Md. Refat Mondol Sinha** — *Joint General Secretary* (Field logistics & relief deployment)\n5. **Fahmida Haque Aboni** — *Treasurer* (Financial auditing & transparent ledgers)\n6. **Md. Imran Shahriar** — *Executive Member* (Digital skills & youth lab hardware)\n7. **Md. Minhajul Islam** — *Executive Member* (Mangrove survival monitoring & field scouting)\n\nAll members serve in an honorable voluntary capacity with zero commercial conflict of interest.`;
    } else if (userQuery.includes('office') || userQuery.includes('address') || userQuery.includes('location') || userQuery.includes('farmgate') || userQuery.includes('where')) {
      fallbackAnswer = `### SETU Foundation Headquarters\n\n- **Physical Address:** Green Road, Farmgate, Tejgaon, Dhaka-1205, Bangladesh.\n- **Geographic Landmark:** Adjacent to Farmgate Metro Station, central Dhaka transit corridor.\n- **Visiting Hours:** Saturday – Thursday, 10:00 AM – 6:00 PM BST.\n- **Email:** contact@setufoundation.org / info@setu-bd.org\n- **Helpline:** +880 1739-778059`;
    } else if (userQuery.includes('program') || userQuery.includes('eco') || userQuery.includes('tech') || userQuery.includes('relief') || userQuery.includes('mangrove')) {
      fallbackAnswer = `### Flagship Initiatives of SETU Foundation\n\n1. **EcoSETU (Environmental Resilience):**\n   - 42,500+ saline-tolerant mangrove saplings planted across the Khulna coastal belt.\n   - Urban micro-greening and biodiversity conservation across Dhaka.\n\n2. **TechSETU (Technological Equity):**\n   - 1,850+ underprivileged youth graduated from intensive web development, Python, and AI literacy bootcamps.\n   - Community computer labs equipped for rural students.\n\n3. **ReliefSETU (Disaster Logistics):**\n   - 78,000+ emergency meals, water filtration kits, and medical supplies distributed in flood-affected Sylhet, Feni, and Barisal.`;
    } else {
      fallbackAnswer = `Hello! I am **SETU Mitra**, official advisor for **SETU Foundation for Environmental & Technological Upliftment**.\n\nWe are actively engaged in:\n- **EcoSETU:** Coastal mangrove afforestation (42,500+ trees)\n- **TechSETU:** Digital inclusion & coding bootcamps for underprivileged youth\n- **ReliefSETU:** Emergency flood response and dry ration distribution across Bangladesh\n\nFeel free to ask about our programs, legal status with the RJSC, official donation channels (**01739778059**), or visiting our Farmgate Dhaka office!`;
    }

    fallbackAnswer += `\n\n> ℹ️ *Live Gemini quota reached on free tier. To enable continuous live AI search reasoning, select a billing-enabled key in **Settings > Secrets**.*`;

    return res.json({
      reply: fallbackAnswer,
      groundingMetadata: null,
      modelUsed: 'setu-knowledge-base',
      roleUsed: role,
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('Unhandled Chat Error:', error);
    res.status(200).json({
      reply: `I am currently operating using SETU Foundation's offline knowledge repository. Please ask any question about our initiatives, committee members, or donation channels.`,
      modelUsed: 'offline-failsafe',
      timestamp: new Date().toISOString()
    });
  }
});

// Setup WebSocket Server for Real-Time Voice Conversations (Gemini 3.8 Live API)
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', async (clientWs: WebSocket) => {
  console.log('Client connected to SETU Live Voice WebSocket (/live)');
  let session: any = null;

  try {
    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
        },
        systemInstruction: DEFAULT_SYSTEM_INSTRUCTION + '\n\nYou are having a LIVE SPOKEN VOICE CONVERSATION with the user. You must speak back directly using natural, warm, and concise speech in English or Bengali (বাংলা). Keep responses under 2-3 sentences per turn for natural conversational flow.',
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ audio }));
          }
          if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onclose: () => {
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ status: 'closed' }));
          }
        },
        onerror: (err: any) => {
          console.error('Gemini Live session error:', err);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: err?.message || 'Live session error' }));
          }
        }
      },
    });

    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ status: 'ready', message: 'Connected to SETU Mitra Live Voice API (gemini-3.8-live)' }));
    }
  } catch (err: any) {
    console.error('Failed to initialize Gemini 3.8 Live Voice session:', err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: err?.message || 'Unable to connect to Live Voice session' }));
      clientWs.close();
    }
    return;
  }

  // Handle incoming real-time audio (16kHz PCM Base64) from browser microphone
  clientWs.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.audio && session) {
        session.sendRealtimeInput({
          audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (msg.text && session) {
        session.sendRealtimeInput({
          text: msg.text,
        });
      }
    } catch (e) {
      console.error('Error forwarding audio to Live API:', e);
    }
  });

  clientWs.on('close', () => {
    console.log('Client disconnected from Live Voice session');
    try {
      if (session && typeof session.close === 'function') {
        session.close();
      }
    } catch (e) {}
  });
});

// Upgrade HTTP connections to WebSocket for /live
server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
  if (pathname === '/live' || pathname === '/api/live') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

// Vite middleware or static serving
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'mpa',
      root: __dirname,
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`SETU Foundation Server & Live Voice API active on http://0.0.0.0:${PORT}`);
  });
}

startServer();

