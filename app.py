from fastapi import FastAPI, Query
from fastapi.responses import FileResponse, JSONResponse
import yt_dlp
import tempfile
import os
import uvicorn

app = FastAPI()

@app.get("/download")
async def download(url: str = Query(..., description="YouTube video URL")):
    if not url:
        return JSONResponse(content={"error": "Missing url"}, status_code=400)

    # temporary file (without extension)
    tmp_base = tempfile.NamedTemporaryFile(delete=False).name
    mp3_path = tmp_base + ".mp3"

    ydl_opts = {
        "format": "bestaudio/best",
        "outtmpl": tmp_base,   # base path (yt-dlp will add .mp3)
        "quiet": True,
        "noplaylist": True,
        "nocheckcertificate": True,
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
    }

    try:
        yt_dlp.YoutubeDL(ydl_opts).download([url])
    except Exception as e:
        return JSONResponse(content={"error": f"yt-dlp failed: {str(e)}"}, status_code=500)

    if not os.path.exists(mp3_path):
        return JSONResponse(content={"error": "No mp3 file produced"}, status_code=500)

    return FileResponse(mp3_path, media_type="audio/mpeg", filename="audio.mp3")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
