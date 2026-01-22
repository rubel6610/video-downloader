import { spawn } from "child_process";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get("url");

    if (!url) {
      return new Response(
        JSON.stringify({ error: "URL is required" }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get available formats from yt-dlp
    const ytdlp = spawn("yt-dlp", [
      "-F",  // List formats
      "--no-playlist",
      "--no-warnings",
      "--ignore-errors",
      "--compat-options", "no-youtube-unavailable-videos",
      url
    ]);

    let stdoutData = '';
    let stderrData = '';

    ytdlp.stdout.on("data", (data) => {
      stdoutData += data.toString();
    });

    ytdlp.stderr.on("data", (data) => {
      stderrData += data.toString();
    });

    const exitCode = await new Promise((resolve) => {
      ytdlp.on("close", resolve);
    });

    // Default available qualities for all platforms
    const defaultQualities = ["144", "240", "360", "480", "720", "1080", "1440", "2160", "best", "worst"];
    
    if (exitCode !== 0) {
      // For all platforms, return default qualities
      return new Response(
        JSON.stringify({
          availableQualities: defaultQualities,
          hasAudio: true,
          defaultMode: true,
        }),
        { 
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Parse available qualities from yt-dlp output
    const lines = stdoutData.split('\n');
    const availableQualities = new Set(["best", "worst"]);
    
    // Extract video qualities
    for (const line of lines) {
      // Match format codes with quality
      const qualityMatch = line.match(/(\d+)\s+\w+\s+(\d+)x(\d+)/);
      if (qualityMatch) {
        const height = parseInt(qualityMatch[3]);
        // Add standard qualities
        if (height <= 144) availableQualities.add("144");
        else if (height <= 240) availableQualities.add("240");
        else if (height <= 360) availableQualities.add("360");
        else if (height <= 480) availableQualities.add("480");
        else if (height <= 720) availableQualities.add("720");
        else if (height <= 1080) availableQualities.add("1080");
        else if (height <= 1440) availableQualities.add("1440");
        else if (height <= 2160) availableQualities.add("2160");
      }
      
      // Match quality strings like "1080p"
      const qualityStrMatch = line.match(/(\d+)p/);
      if (qualityStrMatch) {
        availableQualities.add(qualityStrMatch[1]);
      }
    }

    // If no qualities found, use defaults
    if (availableQualities.size <= 2) {
      defaultQualities.forEach(q => availableQualities.add(q));
    }

    // Sort qualities
    const sortedQualities = Array.from(availableQualities)
      .filter(q => !isNaN(q) || q === "best" || q === "worst")
      .sort((a, b) => {
        if (a === "best") return 1;
        if (b === "best") return -1;
        if (a === "worst") return 1;
        if (b === "worst") return -1;
        return parseInt(a) - parseInt(b);
      });

    // Check if audio is available
    const hasAudio = stdoutData.toLowerCase().includes('audio only') || 
                    lines.some(line => line.includes('audio only') || line.includes('m4a'));

    return new Response(
      JSON.stringify({
        availableQualities: sortedQualities,
        hasAudio: hasAudio,
        defaultMode: false,
      }),
      { 
        status: 200,
        headers: { 
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store'
        }
      }
    );

  } catch (err) {
    console.error("Format check error:", err);
    return new Response(
      JSON.stringify({ 
        error: "Format check failed",
        details: err.message,
        availableQualities: ["144", "240", "360", "480", "720", "1080", "best", "worst"],
        hasAudio: true,
        defaultMode: true
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}