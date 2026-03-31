import express from "express";
import { Innertube } from "youtubei.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { Readable } from "stream";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

let yt;
async function getYT() {
  if (!yt) {
    yt = await Innertube.create({
      client_type: "TV_EMBEDDED",
      generate_session_locally: true,
    });
  }
  return yt;
}

app.get("/download", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing ?q=" });

  try {
    const youtube = await getYT();

    const search = await youtube.search(query, { type: "video" });
    const top = search.videos[0];
    if (!top) return res.status(404).json({ error: "No results found" });

    const videoId = top.id;
    const title = top.title?.text || "audio";
    console.log(`Downloading: "${title}" (${videoId})`);

    const info = await youtube.getBasicInfo(videoId, "TV_EMBEDDED");

    const formats = info.streaming_data?.adaptive_formats || [];
    const audioFormat = formats
      .filter(f => f.has_audio && !f.has_video)
      .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    if (!audioFormat?.url) {
      return res.status(500).json({ error: "No audio stream URL found" });
    }

    const safeTitle = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader("Content-Type", "audio/mpeg");

    const audioRes = await fetch(audioFormat.url);
    if (!audioRes.ok) throw new Error(`Fetch failed: ${audioRes.status}`);

    const nodeStream = Readable.fromWeb(audioRes.body);

    ffmpeg(nodeStream)
      .inputFormat("webm")
      .audioCodec("libmp3lame")
      .audioBitrate(192)
      .format("mp3")
      .on("error", (err) => {
        console.error("FFmpeg error:", err.message);
        if (!res.headersSent) res.status(500).json({ error: "Conversion failed" });
      })
      .pipe(res, { end: true });

  } catch (err) {
    console.error("Error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/search", async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: "Missing ?q=" });
  try {
    const youtube = await getYT();
    const search = await youtube.search(query, { type: "video" });
    const top = search.videos[0];
    res.json({
      id: top.id,
      title: top.title?.text,
      channel: top.author?.name,
      duration: top.duration?.text,
      url: `https://youtube.com/watch?v=${top.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "ok", usage: "/download?q=song+name" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

