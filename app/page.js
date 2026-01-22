"use client";

import { useState, useEffect, useRef } from "react";

export default function Home() {
  const [url, setUrl] = useState("");
  const [type, setType] = useState("video");
  const [quality, setQuality] = useState("best");
  const [loading, setLoading] = useState(false);
  const [checkingFormats, setCheckingFormats] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [availableQualities, setAvailableQualities] = useState([]);
  const [hasAudio, setHasAudio] = useState(true);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [downloadedSize, setDownloadedSize] = useState("0 MB");
  const [estimatedTime, setEstimatedTime] = useState("");
  
  const controllerRef = useRef(null);
  const startTimeRef = useRef(null);
  const lastLoadedRef = useRef(0);
  const speedIntervalRef = useRef(null);

  const allQualities = ["best", "2160", "1440", "1080", "720", "480", "360", "240", "144", "worst"];

  // Quality labels for display
  const qualityLabels = {
    "best": "Best",
    "2160": "4K (2160p)",
    "1440": "QHD (1440p)",
    "1080": "FHD (1080p)",
    "720": "HD (720p)",
    "480": "480p",
    "360": "360p",
    "240": "240p",
    "144": "144p",
    "worst": "Worst"
  };

  // Check available formats when URL changes
  useEffect(() => {
    const checkFormats = async () => {
      if (!url.trim() || url.length < 10) {
        setAvailableQualities([]);
        setHasAudio(true);
        return;
      }

      setCheckingFormats(true);
      setError(null);
      setSuccess(false);
      
      try {
        const response = await fetch(`/api/check-formats?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        
        if (response.ok) {
          const qualities = (data.availableQualities || []).map(q => q.toString());
          setAvailableQualities(qualities);
          setHasAudio(data.hasAudio !== false);
          
          if (qualities.length > 0) {
            // Auto-select best quality if available, otherwise highest numeric
            if (qualities.includes("best")) {
              setQuality("best");
            } else {
              const numericQualities = qualities
                .filter(q => !isNaN(q))
                .map(q => parseInt(q));
              if (numericQualities.length > 0) {
                const highest = Math.max(...numericQualities);
                setQuality(highest.toString());
              }
            }
          }
        } else {
          setAvailableQualities(allQualities);
          setHasAudio(true);
        }
      } catch (err) {
        console.error("Format check failed:", err);
        setAvailableQualities(allQualities);
        setHasAudio(true);
      } finally {
        setCheckingFormats(false);
      }
    };

    const timeoutId = setTimeout(checkFormats, 800);
    return () => clearTimeout(timeoutId);
  }, [url]);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const handleDownload = async () => {
    if (!url.trim()) {
      setError("Please enter a URL");
      return;
    }

    // Reset states
    setLoading(true);
    setError(null);
    setSuccess(false);
    setDownloadProgress(0);
    setDownloadStatus("Initializing download...");
    setDownloadedSize("0 MB");
    setEstimatedTime("");
    
    startTimeRef.current = Date.now();
    lastLoadedRef.current = 0;

    // Create abort controller
    controllerRef.current = new AbortController();

    // Start speed calculation interval
    speedIntervalRef.current = setInterval(() => {
      if (startTimeRef.current && lastLoadedRef.current > 0) {
        const elapsed = (Date.now() - startTimeRef.current) / 1000;
        const speed = lastLoadedRef.current / elapsed;
        const speedText = formatFileSize(speed) + "/s";
        setDownloadStatus(`Downloading at ${speedText}...`);
      }
    }, 1000);

    try {
      const query = new URLSearchParams({
        url: url.trim(),
        type,
        quality,
      });

      const response = await fetch(`/api/download?${query.toString()}`, {
        signal: controllerRef.current.signal
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMsg = errorData.details || errorData.error || 'Download failed';
        
        if (errorMsg.includes("not available")) {
          setAvailableQualities(prev => prev.filter(q => q !== quality));
        }
        
        throw new Error(errorMsg);
      }

      // Get total size from headers
      const contentLength = response.headers.get('Content-Length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;

      // Get filename
      const contentDisposition = response.headers.get('Content-Disposition');
      let filename = 'download';
      
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) {
          filename = decodeURIComponent(match[1]);
        }
      }

      // Read the response stream with progress tracking
      const reader = response.body.getReader();
      const chunks = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        chunks.push(value);
        receivedLength += value.length;
        lastLoadedRef.current = receivedLength;
        
        // Update progress
        setDownloadedSize(formatFileSize(receivedLength));
        
        if (total > 0) {
          const progress = Math.round((receivedLength / total) * 100);
          setDownloadProgress(progress);
          
          // Calculate estimated time
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          if (elapsed > 1 && receivedLength > 0) {
            const speed = receivedLength / elapsed;
            const remaining = (total - receivedLength) / speed;
            if (remaining < 60) {
              setEstimatedTime(`${Math.round(remaining)}s`);
            } else if (remaining < 3600) {
              setEstimatedTime(`${Math.round(remaining / 60)}m`);
            } else {
              setEstimatedTime(`${Math.round(remaining / 3600)}h`);
            }
          }
        } else {
          const progress = Math.min(95, Math.round((receivedLength / (10 * 1024 * 1024)) * 100));
          setDownloadProgress(progress);
        }
      }

      // Download complete
      clearInterval(speedIntervalRef.current);
      setDownloadProgress(100);
      setDownloadStatus("Processing file...");

      // Combine chunks into blob
      const blob = new Blob(chunks);
      
      if (blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      // Create download link
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      
      // Cleanup
      setTimeout(() => {
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
        setSuccess(true);
        setLoading(false);
        setDownloadStatus("Download complete!");
        
        // Reset progress after 3 seconds
        setTimeout(() => {
          setDownloadProgress(0);
          setDownloadStatus("");
          setDownloadedSize("0 MB");
          setEstimatedTime("");
        }, 3000);
      }, 100);

    } catch (err) {
      clearInterval(speedIntervalRef.current);
      
      if (err.name === 'AbortError') {
        console.log('Download cancelled');
        setError("Download cancelled");
      } else {
        console.error('Download error:', err);
        setError(err.message);
      }
      
      setLoading(false);
      setDownloadProgress(0);
      setDownloadStatus("");
    }
  };

  const cancelDownload = () => {
    if (controllerRef.current) {
      controllerRef.current.abort();
      clearInterval(speedIntervalRef.current);
      setLoading(false);
      setDownloadProgress(0);
      setDownloadStatus("");
      setError("Download cancelled");
    }
  };

  // Filter qualities to only show available ones
  const availableQualityButtons = allQualities.filter(q => 
    type === "audio" || availableQualities.length === 0 || availableQualities.includes(q)
  );

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex flex-col items-center justify-center p-4 md:p-6 lg:p-8">
      {/* Animated background elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-10 left-10 w-64 h-64 md:w-72 md:h-72 bg-white/10 rounded-full blur-3xl animate-pulse"></div>
        <div className="absolute bottom-10 right-10 w-80 h-80 md:w-96 md:h-96 bg-white/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }}></div>
        <div className="absolute top-1/2 left-1/4 w-48 h-48 bg-white/5 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      <div className="w-full max-w-4xl bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 lg:p-10 relative z-10 mx-4">
        {/* Header */}
        <div className="text-center mb-8 md:mb-10">
          <div className="inline-flex p-3 md:p-4 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mb-4 shadow-lg">
            <svg className="w-10 h-10 md:w-12 md:h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
            </svg>
          </div>
          <h1 className="text-3xl md:text-4xl lg:text-5xl font-extrabold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent mb-2 md:mb-3 px-2">
            Universal Downloader
          </h1>
          <p className="text-gray-600 text-base md:text-lg px-2">
            Download YouTube videos and audio in high quality
          </p>
        </div>

        {/* URL Input */}
        <div className="mb-6 md:mb-8">
          <label className="block text-gray-700 font-semibold mb-2 md:mb-3 text-sm uppercase tracking-wide">
            Video URL
          </label>
          <div className="relative">
            <input
              type="text"
              className="w-full px-4 md:px-6 py-3 md:py-4 text-base md:text-lg border-2 border-gray-200 rounded-xl md:rounded-2xl focus:border-purple-500 focus:ring-2 md:focus:ring-4 focus:ring-purple-100 outline-none transition-all placeholder:text-gray-400 bg-gray-50 focus:bg-white"
              placeholder="https://youtube.com/watch?v=..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
                setSuccess(false);
              }}
              disabled={loading}
            />
            {url && !loading && (
              <button
                onClick={() => {
                  setUrl("");
                  setAvailableQualities([]);
                  setError(null);
                  setSuccess(false);
                }}
                className="absolute right-3 md:right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Type Selection */}
        <div className="mb-6 md:mb-8">
          <label className="block text-gray-700 font-semibold mb-2 md:mb-3 text-sm uppercase tracking-wide">
            Format Type
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <button
              onClick={() => setType("video")}
              className={`group relative overflow-hidden py-3 md:py-4 lg:py-5 rounded-xl md:rounded-2xl font-bold transition-all duration-300 hover:scale-[1.02] ${
                type === "video"
                  ? "bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg md:shadow-xl shadow-blue-500/50"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
              disabled={loading}
            >
              <div className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                <span className="text-sm md:text-base">Video</span>
              </div>
            </button>
            <button
              onClick={() => setType("audio")}
              className={`group relative overflow-hidden py-3 md:py-4 lg:py-5 rounded-xl md:rounded-2xl font-bold transition-all duration-300 hover:scale-[1.02] ${
                type === "audio"
                  ? "bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-lg md:shadow-xl shadow-green-500/50"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              } ${!hasAudio ? "opacity-50 cursor-not-allowed" : ""}`}
              disabled={loading || !hasAudio}
              title={!hasAudio ? "Audio not available for this video" : ""}
            >
              <div className="flex items-center justify-center gap-2">
                <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                </svg>
                <span className="text-sm md:text-base">Audio MP3</span>
                {!hasAudio && <span className="text-xs opacity-70">(N/A)</span>}
              </div>
            </button>
          </div>
        </div>

        {/* Quality Selection - Only show for video */}
        {type === "video" && (
          <div className="mb-6 md:mb-8">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-3 gap-2">
              <label className="text-gray-700 font-semibold text-sm uppercase tracking-wide">
                Video Quality
              </label>
              {checkingFormats && (
                <span className="text-xs md:text-sm text-purple-600 flex items-center font-medium">
                  <svg className="animate-spin h-3 w-3 md:h-4 md:w-4 mr-2" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Checking available qualities...
                </span>
              )}
            </div>
            
            {/* Quality buttons grid - Responsive */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 md:gap-3">
              {availableQualityButtons.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className={`relative py-2 md:py-3 rounded-lg md:rounded-xl font-bold transition-all duration-300 hover:scale-[1.03] ${
                    quality === q
                      ? "bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-md md:shadow-lg"
                      : "bg-gradient-to-br from-gray-100 to-gray-200 text-gray-800 hover:from-gray-200 hover:to-gray-300"
                  } ${!availableQualities.includes(q) && availableQualities.length > 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                  disabled={loading || (availableQualities.length > 0 && !availableQualities.includes(q)) || checkingFormats}
                  title={availableQualities.length > 0 && !availableQualities.includes(q) ? "This quality is not available" : qualityLabels[q]}
                >
                  <div className="text-sm md:text-base font-semibold">{qualityLabels[q]}</div>
                  {!availableQualities.includes(q) && availableQualities.length > 0 && (
                    <div className="text-xs opacity-60 mt-1">Not Available</div>
                  )}
                  {quality === q && (
                    <div className="absolute top-1 right-1 md:top-2 md:right-2">
                      <svg className="w-3 h-3 md:w-4 md:h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                    </div>
                  )}
                </button>
              ))}
            </div>
            
            {availableQualities.length > 0 && (
              <p className="text-xs md:text-sm text-gray-500 mt-3 text-center">
                ✓ Available: {availableQualities.map(q => qualityLabels[q] || q).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Progress Display */}
        {loading && (
          <div className="mb-6 md:mb-8 p-4 md:p-6 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl md:rounded-2xl border-2 border-indigo-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-3 gap-2">
              <div className="flex-1">
                <span className="text-sm md:text-base text-gray-700 font-medium truncate">{downloadStatus}</span>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-xs md:text-sm text-gray-600">{downloadedSize}</span>
                  {estimatedTime && (
                    <span className="text-xs md:text-sm text-purple-600">ETA: {estimatedTime}</span>
                  )}
                </div>
              </div>
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                {downloadProgress}%
              </span>
            </div>
            
            <div className="relative h-2 md:h-3 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 transition-all duration-300 ease-out rounded-full"
                style={{ width: `${downloadProgress}%` }}
              >
                <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
              </div>
            </div>
            
            {/* Cancel button */}
            <button
              onClick={cancelDownload}
              className="mt-4 w-full py-2 md:py-3 bg-gradient-to-r from-red-500 to-rose-600 text-white font-semibold rounded-lg md:rounded-xl hover:from-red-600 hover:to-rose-700 transition-all shadow-md"
            >
              Cancel Download
            </button>
          </div>
        )}

        {/* Download Button */}
        <div className="mb-6">
          <button
            onClick={handleDownload}
            disabled={loading || !url || (type === "video" && availableQualities.length === 0 && !checkingFormats)}
            className={`group relative w-full py-3 md:py-4 lg:py-5 text-base md:text-lg font-bold rounded-xl md:rounded-2xl transition-all duration-300 overflow-hidden ${
              loading || !url || (type === "video" && availableQualities.length === 0)
                ? "bg-gray-300 cursor-not-allowed text-gray-500"
                : type === "audio"
                ? "bg-gradient-to-r from-green-500 via-emerald-500 to-teal-600 hover:from-green-600 hover:via-emerald-600 hover:to-teal-700 shadow-lg md:shadow-xl shadow-green-500/30 hover:shadow-2xl"
                : "bg-gradient-to-r from-blue-500 via-purple-500 to-pink-600 hover:from-blue-600 hover:via-purple-600 hover:to-pink-700 shadow-lg md:shadow-xl shadow-purple-500/30 hover:shadow-2xl"
            } text-white transform hover:scale-[1.02] active:scale-95`}
          >
            <span className="relative z-10 flex items-center justify-center gap-2 md:gap-3">
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 md:h-6 md:w-6" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Downloading...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5 md:w-6 md:h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  <span>Download {type === "audio" ? "MP3 Audio" : (qualityLabels[quality] || quality + "p")}</span>
                </>
              )}
            </span>
            {!loading && (
              <div className="absolute inset-0 bg-white/10 transform -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
            )}
          </button>
        </div>

        {/* Status Messages */}
        <div className="space-y-4 md:space-y-6">
          {error && (
            <div className="p-4 bg-red-50 border-2 border-red-200 rounded-xl md:rounded-2xl animate-shake">
              <div className="flex items-start">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-red-500 mr-3 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-red-700 block mb-1">Error</span>
                  <p className="text-red-600 text-sm md:text-base break-words">{error}</p>
                </div>
              </div>
            </div>
          )}

          {success && (
            <div className="p-4 bg-green-50 border-2 border-green-200 rounded-xl md:rounded-2xl animate-bounce-once">
              <div className="flex items-start">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-green-500 mr-3 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <span className="font-bold text-green-700 block mb-1">Success!</span>
                  <p className="text-green-600 text-sm md:text-base">Download complete! Check your downloads folder.</p>
                </div>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="mt-6 md:mt-8 pt-6 md:pt-8 border-t-2 border-gray-200">
            <h3 className="text-lg md:text-xl font-bold text-gray-800 mb-3 md:mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 md:w-6 md:h-6 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              How to Use
            </h3>
            <div className="space-y-1">
              {[
                { num: "1", text: "Paste a YouTube URL in the input field above" },
                { num: "2", text: "Choose between Video or Audio format" },
                { num: "3", text: "For video, select your preferred quality (only available options shown)" },
                { num: "4", text: "Click Download and watch the progress bar" }
              ].map((step) => (
                <div key={step.num} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg md:rounded-xl hover:bg-gray-100 transition-colors">
                  <div className="flex-shrink-0 w-7 h-7 md:w-8 md:h-8 bg-gradient-to-br from-purple-500 to-pink-500 text-white rounded-full flex items-center justify-center font-bold text-xs md:text-sm">
                    {step.num}
                  </div>
                  <p className="text-gray-700 text-sm md:text-base pt-1">{step.text}</p>
                </div>
              ))}
            </div>
            
            <div className="mt-4 md:mt-6 p-3 md:p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg md:rounded-xl border-2 border-blue-200">
              <div className="flex items-start gap-2 md:gap-3">
                <svg className="w-4 h-4 md:w-5 md:h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-xs md:text-sm text-blue-800 font-semibold mb-1">Pro Tip</p>
                  <p className="text-xs md:text-sm text-blue-700">
                    Higher quality means better viewing experience but larger file size. The app automatically detects available qualities for each video.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-4 md:pt-6 border-t border-gray-300">
          <p className="text-center text-gray-600 text-xs md:text-sm">
            Made with ❤️ for seamless downloads • Supports YouTube, Instagram, Facebook, Twitter/X, TikTok
          </p>
        </div>
      </div>
    </main>
  );
}