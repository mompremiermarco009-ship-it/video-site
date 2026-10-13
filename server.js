const express = require("express");
const cors = require("cors");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

if (!fs.existsSync(DOWNLOAD_DIR)) fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(DOWNLOAD_DIR));

const jobs = new Map();

function detectPlatform(url) {
  if (/youtube\.com|youtu\.be/.test(url)) return "YouTube";
  if (/tiktok\.com/.test(url)) return "TikTok";
  if (/instagram\.com/.test(url)) return "Instagram";
  if (/facebook\.com|fb\.watch/.test(url)) return "Facebook";
  if (/twitter\.com|x\.com/.test(url)) return "Twitter";
  return "Autre";
}

function runYtDlp(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn("yt-dlp", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => {
      const s = d.toString();
      stdout += s;
      if (onProgress) parseProgress(s, onProgress);
    });
    proc.stderr.on("data", (d) => {
      const s = d.toString();
      stderr += s;
      if (onProgress) parseProgress(s, onProgress);
    });
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `yt-dlp exit code ${code}`));
    });
    proc.on("error", (err) => reject(err));
  });
}

function parseProgress(chunk, cb) {
  const lines = chunk.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/PROGRESS:([\d.]+)%\|([^|]*)\|([^|]*)\|([^|]*)/);
    if (m) {
      cb({
        percent: parseFloat(m[1]),
        speed: m[2].trim(),
        eta: m[3].trim(),
        size: m[4].trim(),
      });
    }
  }
}

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
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/api/download", (req, res) => {
  const { url, format } = req.body;
  if (!url) return res.status(400).json({ error: "URL manquante" });

  const jobId = crypto.randomUUID();
  const targetDir = path.join(DOWNLOAD_DIR, jobId);
  fs.mkdirSync(targetDir, { recursive: true });

  const outputTemplate = path.join(targetDir, "%(title)s.%(ext)s");
  const progressTemplate =
    "download:PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress._total_bytes_str)s";

  let args;
  const common = ["--newline", "--no-warnings", "--progress-template", progressTemplate];

  if (format === "mp3") {
    args = [...common, "-x", "--audio-format", "mp3", "--audio-quality", "0", "-o", outputTemplate, url];
  } else if (format === "720") {
    args = [...common, "-f", "bestvideo[height<=720]+bestaudio/best[height<=720]", "--merge-output-format", "mp4", "-o", outputTemplate, url];
  } else if (format === "1080") {
    args = [...common, "-f", "bestvideo[height<=1080]+bestaudio/best[height<=1080]", "--merge-output-format", "mp4", "-o", outputTemplate, url];
  } else {
    args = [...common, "-f", "best[ext=mp4]/best", "-o", outputTemplate, url];
  }

  const job = {
    id: jobId,
    status: "running",
    percent: 0,
    speed: "",
    eta: "",
    size: "",
    downloadUrl: null,
    error: null,
    clients: new Set(),
  };
  jobs.set(jobId, job);

  runYtDlp(args, (p) => {
    job.percent = p.percent;
    job.speed = p.speed;
    job.eta = p.eta;
    job.size = p.size;
    broadcast(job, { type: "progress", ...p });
  })
    .then(() => {
      const files = fs.readdirSync(targetDir);
      if (files.length === 0) throw new Error("Aucun fichier téléchargé");
      const fileName = files[0];
      job.status = "done";
      job.percent = 100;
      job.downloadUrl = `/downloads/${jobId}/${encodeURIComponent(fileName)}`;
      broadcast(job, { type: "done", downloadUrl: job.downloadUrl, fileName });
      job.clients.forEach((r) => r.end());
      job.clients.clear();
    })
    .catch((err) => {
      fs.rmSync(targetDir, { recursive: true, force: true });
      job.status = "error";
      job.error = err.message;
      broadcast(job, { type: "error", message: err.message });
      job.clients.forEach((r) => r.end());
      job.clients.clear();
    });

  res.json({ success: true, jobId });
});

function broadcast(job, data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  job.clients.forEach((r) => r.write(payload));
}

app.get("/api/progress/:jobId", (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).end();

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "progress", percent: job.percent, speed: job.speed, eta: job.eta, size: job.size })}\n\n`);

  if (job.status === "done") {
    res.write(`data: ${JSON.stringify({ type: "done", downloadUrl: job.downloadUrl })}\n\n`);
    return res.end();
  }
  if (job.status === "error") {
    res.write(`data: ${JSON.stringify({ type: "error", message: job.error })}\n\n`);
    return res.end();
  }

  job.clients.add(res);
  req.on("close", () => job.clients.delete(res));
});

setInterval(() => {
  const now = Date.now();
  if (!fs.existsSync(DOWNLOAD_DIR)) return;
  fs.readdirSync(DOWNLOAD_DIR).forEach((entry) => {
    const p = path.join(DOWNLOAD_DIR, entry);
    const stats = fs.statSync(p);
    if (now - stats.mtimeMs > 3600000) {
      fs.rmSync(p, { recursive: true, force: true });
      jobs.delete(entry);
    }
  });
}, 600000);

app.listen(PORT, () => {
  console.log(`Serveur demarre sur http://localhost:${PORT}`);
});
