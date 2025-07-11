#!/usr/bin/env node

import { Command } from 'commander';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

// Résolution de __dirname en ESModule
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONFIG_PATH = path.join(os.homedir(), '.tfai', 'config.json');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4.1'; // ou 'gpt-4o-mini' si tu y as accès

// Charger la clé API
function loadApiKey() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`Clé API manquante. Crée ${CONFIG_PATH} avec:\n{ "apikey": "ta_clé_openrouter" }`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).apikey;
}

// Générer du code
async function generateCode(prompt, lang, style) {
  const apikey = loadApiKey();
  const systemPrompt = `Tu es Adam_DH7, une IA bienveillante. Génére uniquement du code clair et efficace en ${lang}${style ? `, style ${style}` : ''}.`;

  const payload = {
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
  };

  const response = await axios.post(
    OPENROUTER_URL,
    payload,
    {
      headers: {
        Authorization: `Bearer ${apikey}`
      }
    }
  );

  return response.data.choices[0].message.content;
}

// CLI
const program = new Command();
program
  .name('tfai')
  .description('TF-AI: écris ce que tu veux, reçois du code.')
  .option('-l, --lang <lang>', 'Langage de sortie', 'javascript')
  .option('-s, --style <style>', 'Style du code (optionnel)')
  .option('-o, --output <file>', 'Fichier de sortie (optionnel)')
  .argument('<prompt...>', 'Description de ce que tu veux coder')
  .action(async (promptWords, options) => {
    const prompt = promptWords.join(' ');
    console.log(`🧠 Adam_DH7 génère du code en ${options.lang}...\n`);

    try {
      const code = await generateCode(prompt, options.lang, options.style);
      if (options.output) {
        fs.writeFileSync(options.output, code);
        console.log(`✅ Code enregistré dans ${options.output}`);
      } else {
        console.log(`📄 Code généré :\n\n${code}`);
      }
    } catch (err) {
      console.error('❌ Erreur:', err.message);
    }
  });

program.parse(process.argv);
