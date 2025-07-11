#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Configuration
const CONFIG_PATH = path.join(os.homedir(), '.tfai', 'config.json');
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';

// Charger la clé API
function loadApiKey() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(\`Clé API manquante. Crée \${CONFIG_PATH} avec:\n{ "apikey": "ta_clé_openrouter" }\`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).apikey;
}

// Générer du code
async function generateCode(prompt, lang, style) {
  const apikey = loadApiKey();
  const systemPrompt = \`Tu es Adam_DH7, une IA bienveillante. Génére uniquement du code clair et efficace en \${lang}\${style ? `, style \${style}` : ''}.\`;

  const res = await axios.post(OPENROUTER_URL, {
    model: DEFAULT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ]
  }, {
    headers: { Authorization: \`Bearer \${apikey}\` }
  });

  return res.data.choices[0].message.content;
}

// CLI
const program = new Command();
program
  .name('tfai')
  .description('TF-AI: écris ce que tu veux, reçois du code.')
  .option('-l, --lang <lang>', 'Langage de sortie', 'javascript')
  .option('-s, --style <style>', 'Style du code (optionnel)')
  .option('-o, --output <file>', 'Fichier de sortie (optionnel)')
  .argument('<prompt...>', 'Ce que tu veux coder')
  .action(async (promptWords, options) => {
    const prompt = promptWords.join(' ');
    console.log(\`🧠 Adam_DH7 génère du code en \${options.lang}...\`);

    try {
      const code = await generateCode(prompt, options.lang, options.style);
      if (options.output) {
        fs.writeFileSync(options.output, code);
        console.log(\`✅ Code enregistré dans \${options.output}\`);
      } else {
        console.log(\n📄 Code généré:\n\n\${code}\`);
      }
    } catch (err) {
      console.error('❌ Erreur:', err.message);
    }
  });

program.parse(process.argv);
