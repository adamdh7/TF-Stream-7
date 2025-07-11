import express from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import youtubedl from 'youtube-dl-exec';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
const tmpDir = uploadsDir;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tmpDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });
  const url = `${req.protocol}://${req.get('host')}/uploads/${file.filename}`;
  res.json({ url });
});

app.use('/uploads', express.static(tmpDir));

app.post('/api/video/info', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing video URL' });
  }

  try {
    const meta = await youtubedl(url, { dumpSingleJson: true });
    const id = meta.id || Date.now();
    const title = meta.title || 'video';
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${Date.now()}_${safeTitle}.mp4`;
    const filePath = path.join(tmpDir, fileName);

    let embed = '';
    if (meta.extractor === 'youtube') {
      embed = `<iframe width="100%" height="360" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen></iframe>`;
    } else if (meta.extractor === 'vimeo') {
      embed = `<iframe src="https://player.vimeo.com/video/${id}" width="100%" height="360" frameborder="0" allowfullscreen></iframe>`;
    } else {
      embed = `<video width="100%" height="auto" controls><source src="${url}" type="video/mp4"></video>`;
    }

    await youtubedl(url, {
      output: filePath,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4'
    });

    const downloadUrl = `${req.protocol}://${req.get('host')}/uploads/${fileName}`;
    res.json({ embed, downloadUrl });
  } catch (err) {
    console.error('Video processing error:', err);
    res.status(500).json({ error: 'Failed to process video' });
  }
});

app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
