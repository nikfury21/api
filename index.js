import express from "express";
import { Innertube } from "youtubei.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { PassThrough, Readable } from "stream";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Cache the Innertube instance — expensive to create
let yt;
async function getYT() {
  if (!yt) {
    yt = await Innertube.create({
      // Helps avoid bot detection on shared IPs
      generate_session_locally: true,
    });
  }
  return yt;
}

/**
 * GET /download?q=your+search+query
 * Returns the first YouTube result as an MP3 stream
 */
app.get("/download", async (req, res) => {
  const query = req.query.q;
  if (!query) {
    return res.status(400).json({ error: "Missing ?q= query parameter" });
  }

  try {
    const youtube = await getYT();

    // 1. Search YouTube for the query
    const search = await youtube.search(query, { type: "video" });
    const videos = search.videos;

    if (!videos || videos.length === 0) {
      return res.status(404).json({ error: "No videos found for this query" });
    }

    const topVideo = videos[0];
    const videoId = topVideo.id;
    const title = topVideo.title?.text || "audio";

    console.log(`Found: "${title}" (${videoId})`);

    // 2. Get the streaming info
    const info = await youtube.getInfo(videoId);

    // 3. Choose best audio-only format
    const format = info.chooseFormat({
      type: "audio",
      quality: "best",
    });

    if (!format) {
      return res.status(500).json({ error: "No audio format available" });
    }

    // 4. Get the raw audio stream from YouTube
    const rawStream = await info.download({
      type: "audio",
      quality: "best",
    });

    // Convert ReadableStream (web) to Node.js Readable
    const nodeStream = Readable.fromWeb(rawStream);

    // 5. Set response headers for MP3 download
    const safeTitle = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader("Content-Type", "audio/mpeg");

    // 6. Pipe through ffmpeg to convert to MP3
    ffmpeg(nodeStream)
      .inputFormat(format.mime_type.includes("webm") ? "webm" : "mp4")
      .audioCodec("libmp3lame")
      .audioBitrate(192)
      .format("mp3")
      .on("error", (err) => {
        console.error("FFmpeg error:", err.message);
        if (!res.headersSent) {
          res.status(500).json({ error: "Conversion failed" });
        }
      })
      .pipe(res, { end: true });

  } catch (err) {
    console.error("Error:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

/**
 * GET /search?q=query
 * Preview the first result without downloading
 */
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
      thumbnail: top.thumbnails?.[0]?.url,
      url: `https://youtube.com/watch?v=${top.id}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    usage: {
      download: "/download?q=your+search+query  →  streams MP3",
      search:   "/search?q=your+search+query    →  returns JSON metadata",
    },
  });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
