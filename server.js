const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("crypto").randomUUID ? { v4: () => require("crypto").randomUUID() } : { v4: () => Date.now().toString(36) + Math.random().toString(36).slice(2) };

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(DOWNLOAD_DIR));

// Détection de plateforme
function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "YouTube";
  if (/tiktok\.com/.test(url)) return "TikTok";
  if (/instagram\.com/.test(url)) return "Instagram";
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook";
  if (/twitter\.com|x\.com/.test(url)) return "Twitter";
  return "Autre";
}

// Lancer yt-dlp
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `yt-dlp exited with code ${code}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

// Route : infos vidéo
app.post("/api/info", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  try {
    const out = await runYtDlp(["-J", "--no-warnings", url]);
    const data = JSON.parse(out);
    res.json({
      success: true,
      platform: detectPlatform(url),
      title: data.title,
      duration: data.duration,
      thumbnail: data.thumbnail,
      uploader: data.uploader,
      formats: (data.formats || [])
        .filter((f) => f.ext === "mp4" || f.ext === "m4a")
        .slice(-10)
        .map((f) => ({
          formatId: f.format_id,
          ext: f.ext,
          quality: f.format_note || f.resolution || "audio",
          size: f.filesize || f.filesize_approx,
        })),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Route : téléchargement
app.post("/api/download", async (req, res) => {
  const { url, format } = req.body;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  const id = uuidv4();
  const targetDir = path.join(DOWNLOAD_DIR, id);
  fs.mkdirSync(targetDir, { recursive: true });

  const outputTemplate = path.join(targetDir, "%(title)s.%(ext)s");

  let args;
  if (format === "mp3") {
    args = ["-x", "--audio-format", "mp3", "--audio-quality", "0", "-o", outputTemplate, url];
  } else if (format === "720") {
    args = ["-f", "bestvideo[height<=720]+bestaudio/best[height<=720]", "--merge-output-format", "mp4", "-o", outputTemplate, url];
  } else if (format === "1080") {
    args = ["-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]", "--merge-output-format", "mp4", "-o", outputTemplate, url];
  } else {
    args = ["-f", "best[ext=mp4]/best", "-o", outputTemplate, url];
  }

  try {
    await runYtDlp(args);
    const files = fs.readdirSync(targetDir);
    if (files.length === 0) throw new Error("Aucun fichier téléchargé");

    const fileName = files[0];
    res.json({
      success: true,
      fileName,
      downloadUrl: `/downloads/${id}/${encodeURIComponent(fileName)}`,
      platform: detectPlatform(url),
    });
  } catch (err) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    res.status(500).json({ success: false, error: err.message });
  }
});

// Nettoyage : supprime les fichiers > 1h
setInterval(() => {
  const now = Date.now();
  if (!fs.existsSync(DOWNLOAD_DIR)) return;
  fs.readdirSync(DOWNLOAD_DIR).forEach((entry) => {
    const p = path.join(DOWNLOAD_DIR, entry);
    const stats = fs.statSync(p);
    if (now - stats.mtimeMs > 3600000) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  });
}, 600000);

app.listen(PORT, () => {
  console.log(`✅ Serveur démarré sur http://localhost:${PORT}`);
});
