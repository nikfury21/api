import express from "express";
import { Innertube } from "youtubei.js";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import { Readable } from "stream";
import { ProxyAgent } from "undici";

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const PORT = process.env.PORT || 3000;

// Your Webshare proxy - set these as Render environment variables
const PROXY_URL = process.env.PROXY_URL; // e.g. http://user:pass@proxy.webshare.io:80

let yt;
async function getYT() {
  if (!yt) {
    const options = { generate_session_locally: true };
    if (PROXY_URL) {
      options.fetch = (url, init) =>
        fetch(url, { ...init, dispatcher: new ProxyAgent(PROXY_URL) });
    }
    yt = await Innertube.create(options);
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

    let audioFormat = null;
    for (const client of ["IOS", "ANDROID", "WEB"]) {
      try {
        const info = await youtube.getBasicInfo(videoId, client);
        const formats = info.streaming_data?.adaptive_formats || [];
        const found = formats
          .filter(f => f.has_audio && !f.has_video)
          .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
        if (found?.url) {
          audioFormat = found;
          console.log(`Got stream via ${client}`);
          break;
        }
      } catch (e) {
        console.log(`${client} failed: ${e.message}`);
      }
    }

    if (!audioFormat?.url) {
      return res.status(500).json({ error: "No stream found" });
    }

    const safeTitle = title.replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader("Content-Type", "audio/mpeg");

    const dispatcher = PROXY_URL ? new ProxyAgent(PROXY_URL) : undefined;
    const audioRes = await fetch(audioFormat.url, { dispatcher });
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

app.get("/", (req, res) => res.json({ status: "ok", usage: "/download?q=song+name" }));

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
