const express = require('express');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Asire dosye uploads la egziste
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// 📁 FileMap path pou sove done yo
const FILEMAP_PATH = path.join(__dirname, 'fileMap.json');
const fileMap = new Map();

// ⚙️ Chaje fileMap si li egziste
if (fs.existsSync(FILEMAP_PATH)) {
  const raw = fs.readFileSync(FILEMAP_PATH);
  const data = JSON.parse(raw);
  for (const tfid in data) {
    fileMap.set(tfid, data[tfid]);
  }
}

// ✅ Fonksyon pou sove fileMap la
function saveFileMap() {
  const obj = Object.fromEntries(fileMap.entries());
  fs.writeFileSync(FILEMAP_PATH, JSON.stringify(obj, null, 2));
}

// 🧠 Fonksyon pou kreye TF-ID o aza
function generateTFId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 7; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `TF-${id}`;
}

// 📤 Multer pou upload fichye yo
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  },
});
const upload = multer({ storage });

// 📦 Upload route
app.post('/upload', upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier envoyé.' });

  const tfId = generateTFId();
  const fileUrl = `/uploads/${req.file.filename}`;

  fileMap.set(tfId, fileUrl);
  saveFileMap();

  res.json({ tfId, url: `http://localhost:${PORT}/${tfId}` });
});

// 🔗 Shorten URL route
app.post('/shorten', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'Aucune URL fournie.' });

  const tfId = generateTFId();
  fileMap.set(tfId, url);
  saveFileMap();

  res.json({ tfId, url: `http://localhost:${PORT}/${tfId}` });
});

// 🔁 Redirection ou affichage
app.get('/:tfId', (req, res) => {
  const tfId = req.params.tfId;
  const target = fileMap.get(tfId);

  if (!target) {
    return res.status(404).send('TF-ID introuvable.');
  }

  // Si se yon fichye lokal
  if (target.startsWith('/uploads/')) {
    return res.sendFile(path.join(__dirname, target));
  }

  // Sinon se yon URL ekstèn
  return res.redirect(target);
});

// 🟢 Start server
app.listen(PORT, () => {
  console.log(`✅ Serveur en ligne: http://localhost:${PORT}`);
});
