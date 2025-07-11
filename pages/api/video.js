import { create } from 'youtube-dl-exec';
import path from 'path';
import fs from 'fs';

// Pwen dirèksyon yt-dlp nan Termux; si w sou Vercel, jis retire chemen pou l sèvi ak default
const ytdl = create('/data/data/com.termux/files/usr/bin/yt-dlp');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid URL' });
  }

  try {
    // Récupère métadonnées
    const meta = await ytdl(url, { dumpSingleJson: true });
    const id = meta.id || Date.now();
    const title = meta.title || 'video';
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const fileName = `${Date.now()}_${safeTitle}.mp4`;

    // Kreye folder uploads si oblije
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const filePath = path.join(uploadsDir, fileName);

    // Telechaje pi bon MP4
    await ytdl(url, {
      output: filePath,
      format: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/mp4'
    });

    // Bati HTML embed
    let embed = '';
    if (meta.extractor === 'youtube') {
      embed = `<iframe width="100%" height="360" src="https://www.youtube.com/embed/${id}" frameborder="0" allowfullscreen></iframe>`;
    } else if (meta.extractor === 'vimeo') {
      embed = `<iframe src="https://player.vimeo.com/video/${id}" width="100%" height="360" frameborder="0" allowfullscreen></iframe>`;
    } else {
      embed = `<video width="100%" controls><source src="/uploads/${fileName}" type="video/mp4"></video>`;
    }

    const downloadUrl = `/uploads/${fileName}`;
    res.status(200).json({ embed, downloadUrl });
  } catch (err) {
    console.error('Video processing error:', err);
    res.status(500).json({ error: 'Failed to process video' });
  }
}
