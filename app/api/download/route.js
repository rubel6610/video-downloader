import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

export async function GET(req) {
  let tempFilePath = null;
  let outputDir = null;
  
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");
    const quality = searchParams.get("quality") || "best";
    const type = searchParams.get("type") || "video";

    if (!url) {
      return new Response("URL is required", { status: 400 });
    }

    console.log(`Starting download: ${url}, type: ${type}, quality: ${quality}`);

    // -------- TEMP DIRECTORY --------
    const tmpDir = path.join(os.tmpdir(), 'yt-downloads');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const timestamp = Date.now();
    outputDir = path.join(tmpDir, `dl_${timestamp}`);
    fs.mkdirSync(outputDir, { recursive: true });

    const outputTemplate = path.join(outputDir, '%(title).100B [%(id)s].%(ext)s');
    
    // -------- VALIDATE YT-DLP EXISTS --------
    try {
      await new Promise((resolve, reject) => {
        const testProcess = spawn('yt-dlp', ['--version']);
        testProcess.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('yt-dlp not found'));
        });
        testProcess.on('error', () => reject(new Error('yt-dlp not found')));
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          error: "yt-dlp not installed", 
          details: "Please install yt-dlp and ffmpeg first." 
        }), 
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // -------- YT-DLP ARGS --------
    let args = [
      "--ignore-errors",
      "--no-warnings",
      "--retries", "3",
      "--fragment-retries", "3",
      "--no-part",
      "--no-playlist",
      "--user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "--add-header",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "--add-header", "Accept-Language: en-US,en;q=0.5",
      "--add-header", "Accept-Encoding: gzip, deflate",
      "--add-header", "DNT: 1",
      "--add-header", "Connection: keep-alive",
      "--add-header", "Referer: https://www.youtube.com/",
      "--add-header", "Origin: https://www.youtube.com",
      "--no-check-certificate",
      "--compat-options", "no-youtube-unavailable-videos",
      "--extractor-args", "youtube:player_client=android,web",
      "--throttled-rate", "100K",
      "--progress", // Enable progress bar output
      "--newline", // Progress in new lines
      "--progress-template", "download:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
      "-o", outputTemplate,
      url
    ];

    // -------- ADD TYPE-SPECIFIC ARGS --------
    if (type === "audio") {
      args = [
        "-f", "bestaudio/best",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "192K",
        "--embed-thumbnail",
        "--embed-metadata",
        ...args
      ];
    } else {
      let formatSelector = "";
      
      if (quality === "best") {
        formatSelector = "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[ext=mp4]/best";
      } else if (quality === "worst") {
        formatSelector = "worstvideo[ext=mp4]+worstaudio[ext=m4a]/worst[ext=mp4]/worst";
      } else if (!isNaN(quality)) {
        formatSelector = `bestvideo[height<=${quality}][ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
      } else {
        formatSelector = "best[ext=mp4]/best";
      }
      
      args = [
        "-f", formatSelector,
        "--merge-output-format", "mp4",
        ...args
      ];
    }

    console.log("Executing yt-dlp with args:", args);

    // -------- EXECUTE YT-DLP --------
    const ytdlp = spawn("yt-dlp", args, {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';
    let downloadInfo = {
      downloaded: 0,
      total: 0,
      percent: "0%",
      speed: "0 B/s",
      eta: "N/A"
    };

    ytdlp.stdout.on("data", (data) => {
      const text = data.toString();
      stdoutData += text;
      
      // Parse progress information
      const lines = text.split('\n');
      lines.forEach(line => {
        line = line.trim();
        
        // Parse progress line
        if (line.startsWith('download:')) {
          const parts = line.substring(9).split('|'); // Remove "download:" prefix
          if (parts.length >= 5) {
            const downloaded = parseInt(parts[0]) || 0;
            const total = parseInt(parts[1]) || 0;
            const percent = parts[2]?.trim() || "0%";
            const speed = parts[3]?.trim() || "0 B/s";
            const eta = parts[4]?.trim() || "N/A";
            
            downloadInfo = { downloaded, total, percent, speed, eta };
            console.log(`Progress: ${percent}, Downloaded: ${(downloaded / (1024 * 1024)).toFixed(2)}MB, Total: ${(total / (1024 * 1024)).toFixed(2)}MB, Speed: ${speed}, ETA: ${eta}`);
          }
        } else if (line && !line.startsWith('[') && !line.startsWith('WARNING')) {
          console.log("yt-dlp:", line);
        }
      });
    });

    ytdlp.stderr.on("data", (data) => {
      const text = data.toString();
      stderrData += text;
      if (!text.includes('WARNING:')) {
        console.error("yt-dlp stderr:", text.trim());
      }
    });

    const exitCode = await new Promise((resolve, reject) => {
      ytdlp.on("close", (code) => {
        console.log(`yt-dlp exited with code ${code}`);
        resolve(code);
      });
      ytdlp.on("error", (error) => {
        console.error("yt-dlp spawn error:", error);
        reject(error);
      });
    });

    if (exitCode !== 0) {
      console.log("First attempt failed, trying alternative download method...");
      
      const alternativeArgs = [
        "--ignore-errors",
        "--no-warnings",
        "--no-playlist",
        "--progress",
        "--newline",
        "--progress-template", "download:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
        "--user-agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "--no-check-certificate",
        "-o", outputTemplate,
        url
      ];

      if (type === "audio") {
        alternativeArgs.unshift("-f", "bestaudio", "--extract-audio", "--audio-format", "mp3");
      } else {
        alternativeArgs.unshift("-f", "best[ext=mp4]/best");
      }

      const ytdlp2 = spawn("yt-dlp", alternativeArgs);
      
      // Reset download info for second attempt
      downloadInfo = {
        downloaded: 0,
        total: 0,
        percent: "0%",
        speed: "0 B/s",
        eta: "N/A"
      };
      
      ytdlp2.stdout.on("data", (data) => {
        const text = data.toString();
        const lines = text.split('\n');
        lines.forEach(line => {
          line = line.trim();
          if (line.startsWith('download:')) {
            const parts = line.substring(9).split('|');
            if (parts.length >= 5) {
              const downloaded = parseInt(parts[0]) || 0;
              const total = parseInt(parts[1]) || 0;
              const percent = parts[2]?.trim() || "0%";
              const speed = parts[3]?.trim() || "0 B/s";
              const eta = parts[4]?.trim() || "N/A";
              
              downloadInfo = { downloaded, total, percent, speed, eta };
              console.log(`Progress (alt): ${percent}, Speed: ${speed}, ETA: ${eta}`);
            }
          }
        });
      });

      const exitCode2 = await new Promise((resolve) => {
        ytdlp2.on("close", resolve);
      });

      if (exitCode2 !== 0) {
        throw new Error(`Download failed. ${stderrData.slice(-300)}`);
      }
    }

    // -------- FIND DOWNLOADED FILE --------
    let downloadedFile = null;
    let files = [];
    
    try {
      files = fs.readdirSync(outputDir);
      console.log("Files in output dir:", files);
      
      const targetExtensions = type === 'audio' 
        ? ['.mp3', '.m4a'] 
        : ['.mp4', '.mkv'];
      
      for (const file of files) {
        const filePath = path.join(outputDir, file);
        const ext = path.extname(file).toLowerCase();
        
        if (targetExtensions.includes(ext)) {
          const stats = fs.statSync(filePath);
          if (stats.size > 1024) {
            downloadedFile = file;
            tempFilePath = filePath;
            console.log(`Found file: ${file} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
            break;
          }
        }
      }
    } catch (err) {
      console.error("Error finding file:", err);
    }

    if (!downloadedFile) {
      throw new Error("File downloaded but could not be found.");
    }

    // -------- STREAM FILE TO CLIENT --------
    const stats = fs.statSync(tempFilePath);
    console.log(`Sending file: ${downloadedFile}, size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);

    const fileStream = fs.createReadStream(tempFilePath);
    
    // Clean filename for download
    const cleanFilename = downloadedFile.replace(/ \[[^\]]+\]\./, '.');
    const safeFilename = encodeURIComponent(cleanFilename);
    
    const headers = new Headers();
    headers.set("Content-Disposition", `attachment; filename="${safeFilename}"`);
    headers.set("Content-Type", type === "audio" ? "audio/mpeg" : "video/mp4");
    headers.set("Content-Length", stats.size.toString());
    headers.set("X-Download-Size", stats.size.toString());
    headers.set("X-Download-Name", safeFilename);

    const cleanup = () => {
      setTimeout(() => {
        try {
          if (outputDir && fs.existsSync(outputDir)) {
            fs.rmSync(outputDir, { recursive: true, force: true });
            console.log(`Cleaned up: ${outputDir}`);
          }
        } catch (cleanupError) {
          console.error("Cleanup error:", cleanupError);
        }
      }, 3000);
    };

    fileStream.on("close", cleanup);
    fileStream.on("end", cleanup);
    fileStream.on("error", (error) => {
      console.error("File stream error:", error);
      cleanup();
    });

    return new Response(fileStream, { 
      headers,
      status: 200 
    });

  } catch (err) {
    console.error("Download route error:", err.message);
    
    if (outputDir && fs.existsSync(outputDir)) {
      try {
        fs.rmSync(outputDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("Error cleaning up:", cleanupError);
      }
    }
    
    return new Response(
      JSON.stringify({ 
        error: "Download failed", 
        details: err.message
      }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}