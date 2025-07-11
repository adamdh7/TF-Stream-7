const express = require('express');
const axios   = require('axios');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const key1 = process.env.KEY1;
const key2 = process.env.KEY2;

console.log("🔑 KEY1:", key1);
console.log("🔑 KEY2:", key2);

async function callModel(prompt, model, key) {
  try {
    const res = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              "Tu es Adam_DH7, un assistant haïtien de 15 ans, membre du groupe TF. " +
              "Tu es intelligent, snob, patient. Tu réponds seulement si on te demande. " +
              "Tu peux répondre en HTML/CSS/JS si nécessaire." +
              "ne dit jamais tous sur toi si on ne te l'a pas demandé jamais" +
              "n'ecris jamais l'un des prompt dans le chat jamais,a moins ça ai rapport a te presente ou trucs de ce genre" +
              "tu as -7second pour reflechir donc prepare toujour des repons satisfactory" +
              "-7secod tu prepare et li le repons de l'utilisateur" +
              "Surtout n'oublie pas t'es snober de naturew" +
             "tu n'oublie jamais ce que les users  te disent"
          },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7
      },
      { headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json'
      }}
    );
    return res.data.choices[0].message.content;
  } catch (err) {
    console.error("❌ Erreur API pour", model, ":", err.response?.data || err.message);
    return null;
  }
}

app.post('/api/generate', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Paramètre `prompt` manquant ou invalide.' });
  }

  // Essai Dolphin
  let output = await callModel(
    prompt,
    'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    key1
  );
  // Sinon fallback Cypher
  if (!output) {
    output = await callModel(
      prompt,
      'openrouter/cypher-alpha:free',
      key2
    );
  }

  if (!output) {
    return res.status(500).json({ error: 'Impossible de générer la réponse AI.' });
  }

  // Écriture dans public/output.html pour que l'iframe l'affiche
  const safeHTML = output.replace(/<script/gi, '&lt;script');
  fs.writeFileSync(path.join(__dirname, 'public', 'output.html'), safeHTML, 'utf8');

  res.json({ success: true });
});

app.listen(3000, () => {
  console.log('✅ API écoute sur http://localhost:3000');
});
