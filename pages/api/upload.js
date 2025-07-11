import formidable from 'formidable';
import fs from 'fs';
import path from 'path';

export const config = {
  api: {
    bodyParser: false,      // we parse with formidable instead
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST allowed' });
  }

  const form = new formidable.IncomingForm();
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  form.uploadDir = uploadsDir;
  form.keepExtensions = true;

  form.parse(req, (err, fields, files) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(500).json({ error: 'Upload failed' });
    }
    // `files.file` corresponds to `form.append('file', ...)` in the front end
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    const filename = path.basename(file.filepath);
    const url = `/uploads/${filename}`;
    res.status(200).json({ url });
  });
}
