import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from "react";
import {
  VideoIcon,
  SquareIcon,
  PlayIcon,
  PauseIcon,
  DownloadIcon,
  TrashIcon,
  UploadIcon,
  MicIcon,
  MicOffIcon,
  CameraIcon,
  CameraOffIcon,
} from "./icons";
import "./ScreenRecorder.css";

// Inject Inter font
if (typeof document !== "undefined") {
  const fontId = "onscreen-recorder-font";
  if (!document.getElementById(fontId)) {
    const link = document.createElement("link");
    link.id = fontId;
    link.rel = "preconnect";
    link.href = "https://fonts.googleapis.com";
    document.head.appendChild(link);
    
    const link2 = document.createElement("link");
    link2.rel = "preconnect";
    link2.href = "https://fonts.gstatic.com";
    link2.crossOrigin = "anonymous";
    document.head.appendChild(link2);
    
    const link3 = document.createElement("link");
    link3.rel = "stylesheet";
    link3.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap";
    document.head.appendChild(link3);
  }
}

const MAX_CONSOLE_LOGS = 100;
const CHUNK_LOG_EVERY_N = 5;
const CAMERA_PIP_SIZE = 0.2;
const CAMERA_PIP_INSET = 16;
const CAPTURE_FPS = 30;
const getSupportedVideoMimeType = (): { main: string; camera: string } => {
  if (typeof MediaRecorder === "undefined") {
    return { main: "video/webm", camera: "video/webm" };
  }
  
  const mainCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=h264,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a.40.2",
    "video/mp4"
  ];
  
  const cameraCandidates = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=h264",
    "video/webm",
    "video/mp4;codecs=avc1",
    "video/mp4"
  ];
  
  let main = "video/webm";
  for (const type of mainCandidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      main = type;
      break;
    }
  }
  
  let camera = "video/webm";
  for (const type of cameraCandidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      camera = type;
      break;
    }
  }
  
  return { main, camera };
};

const MIME_TYPES = typeof MediaRecorder !== "undefined" ? getSupportedVideoMimeType() : { main: "video/webm", camera: "video/webm" };

type LogType = "info" | "success" | "error";
const LOG_ICON: Record<LogType, string> = { error: "❌", success: "✓", info: "ℹ" };
const logIconClass = (t: LogType) => `onscreen-recorder-log-icon onscreen-recorder-log-icon-${t}`;
const logMsgClass = (t: LogType) => `onscreen-recorder-log-message onscreen-recorder-log-message-${t}`;

export interface ScreenRecorderProps {
  /** Callback when recording starts */
  onRecordingStart?: () => void;
  /** Callback when recording stops */
  onRecordingStop?: (blob: Blob) => void;
  /** Callback when video is downloaded */
  onDownload?: (blob: Blob) => void;
  /** Callback when upload button is clicked - receives the video blob for custom upload handling */
  onUpload?: (blob: Blob) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Enable/disable microphone by default */
  defaultMicEnabled?: boolean;
  /** Enable/disable camera (webcam) by default – records as PiP and a separate camera video file. Only used when showCamera is true. */
  defaultCameraEnabled?: boolean;
  /** When false, camera toggle and camera recording are hidden; recording is screen (+ optional mic) only. Default true. */
  showCamera?: boolean;
  /** Seconds to count down after user selects screen (3, 2, 1 then record). Set to 0 to record immediately after selection. */
  countdownSeconds?: number;
  /** Show the main "Screen Recorder" header. Set to false when embedding in your own layout. */
  showHeader?: boolean;
  /** Show the debug console panel. Set to true for development; keep false for a cleaner end-user UI. */
  showConsole?: boolean;
  /** Custom class name for the container */
  className?: string;
}

const ScreenRecorderComponent: React.FC<ScreenRecorderProps> = ({
  onRecordingStart,
  onRecordingStop,
  onDownload,
  onUpload,
  onError,
  defaultMicEnabled = true,
  defaultCameraEnabled = false,
  showCamera = true,
  countdownSeconds = 3,
  showHeader = true,
  showConsole = false,
  className = "",
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [screenPermissionDeclined, setScreenPermissionDeclined] = useState(false);
  const [micPermissionDeclined, setMicPermissionDeclined] = useState(false);
  const [recordedVideoURL, setRecordedVideoURL] = useState<string | null>(null);
  const [recordedCameraURL, setRecordedCameraURL] = useState<string | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<Array<{ message: string; type: LogType; timestamp: string }>>([]);
  const [micEnabled, setMicEnabled] = useState(defaultMicEnabled);
  const [cameraEnabled, setCameraEnabled] = useState(defaultCameraEnabled);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [hasCameraPermission, setHasCameraPermission] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const cameraRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cameraChunksRef = useRef<Blob[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const recordedBlobRef = useRef<Blob | null>(null);
  const recordedCameraBlobRef = useRef<Blob | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const combinedStreamRef = useRef<MediaStream | null>(null);
  const countdownTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chunkCountRef = useRef(0);
  const drawLoopIdRef = useRef<number | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);


  const addLog = useCallback(
    (message: string, type: LogType = "info") => {
      if (!showConsole) return;
      const timestamp = new Date().toLocaleTimeString();
      setConsoleLogs((prev) => {
        const next = [...prev, { message, type, timestamp }];
        return next.length > MAX_CONSOLE_LOGS ? next.slice(-MAX_CONSOLE_LOGS) : next;
      });
    },
    [showConsole]
  );

  const requestMediaPermission = useCallback(
    async (kind: "audio" | "video"): Promise<MediaStream | null> => {
      const isAudio = kind === "audio";
      const label = isAudio ? "Microphone" : "Camera";
      try {
        addLog(`Requesting ${label.toLowerCase()} permission...`, "info");
        const stream = await navigator.mediaDevices.getUserMedia(isAudio ? { audio: true } : { video: true });
        if (isAudio) {
          micStreamRef.current = stream;
          setHasMicPermission(true);
          setMicPermissionDeclined(false);
        } else {
          cameraStreamRef.current = stream;
          setHasCameraPermission(true);
        }
        addLog(`${label} permission granted`, "success");
        return stream;
      } catch (err) {
        const error = err as Error;
        addLog(`${label} permission denied: ${error.message}`, "error");
        if (isAudio) {
          setHasMicPermission(false);
          if (error.name === "NotAllowedError" || error.message?.includes("Permission") || error.message?.includes("denied")) {
            setMicPermissionDeclined(true);
          }
        }
        else setHasCameraPermission(false);
        if (onError) onError(error);
        return null;
      }
    },
    [addLog, onError, setMicPermissionDeclined]
  );
  const requestMicPermission = useCallback(() => requestMediaPermission("audio"), [requestMediaPermission]);
  const requestCameraPermission = useCallback(() => requestMediaPermission("video"), [requestMediaPermission]);

  const releaseAllStreams = useCallback(() => {
    if (cameraRecorderRef.current?.state === "recording") cameraRecorderRef.current.stop();
    if (drawLoopIdRef.current != null) {
      cancelAnimationFrame(drawLoopIdRef.current);
      drawLoopIdRef.current = null;
    }
    if (canvasStreamRef.current) {
      canvasStreamRef.current.getTracks().forEach((t) => t.stop());
      canvasStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      setHasCameraPermission(false);
      setCameraEnabled(false);
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      setHasMicPermission(false);
    }
    if (combinedStreamRef.current) {
      combinedStreamRef.current.getTracks().forEach((t) => t.stop());
      combinedStreamRef.current = null;
    }
  }, []);

  const compositeScreenWithCamera = useCallback(
    (screenStream: MediaStream, cameraStream: MediaStream): MediaStream => {
      const screenTrack = screenStream.getVideoTracks()[0];
      const settings = screenTrack?.getSettings();
      const w = settings?.width ?? 1920;
      const h = settings?.height ?? 1080;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return screenStream;
      const screenVideo = document.createElement("video");
      screenVideo.srcObject = new MediaStream([screenTrack]);
      screenVideo.muted = true;
      screenVideo.play().catch(() => { });
      const cameraVideo = document.createElement("video");
      cameraVideo.srcObject = cameraStream;
      cameraVideo.muted = true;
      cameraVideo.play().catch(() => { });
      const camW = Math.floor(w * CAMERA_PIP_SIZE);
      const camH = Math.floor(h * CAMERA_PIP_SIZE);
      const camX = w - camW - CAMERA_PIP_INSET;
      const camY = h - camH - CAMERA_PIP_INSET;
      const draw = () => {
        if (screenVideo.readyState >= 2) {
          ctx.drawImage(screenVideo, 0, 0, w, h);
          if (cameraVideo.readyState >= 2) {
            ctx.save();
            const radius = Math.min(camW, camH) / 2;
            const centerX = camX + camW / 2;
            const centerY = camY + camH / 2;
            
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.clip();
            
            ctx.drawImage(cameraVideo, camX, camY, camW, camH);
            ctx.restore();
            
            ctx.save();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
            ctx.lineWidth = Math.max(2, Math.floor(w * 0.002));
            ctx.beginPath();
            ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
        }
        drawLoopIdRef.current = requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(CAPTURE_FPS);
      canvasStreamRef.current = stream;
      return stream;
    },
    []
  );

  const handleCameraButtonClick = useCallback(async () => {
    if (cameraEnabled) {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
      setCameraEnabled(false);
      setHasCameraPermission(false);
      addLog("Camera disabled", "info");
      return;
    }
    const stream = await requestCameraPermission();
    if (stream) setCameraEnabled(true);
  }, [cameraEnabled, addLog, requestCameraPermission]);

  const startMediaRecorderWithStream = useCallback(() => {
    const stream = combinedStreamRef.current;
    const screenStream = screenStreamRef.current;
    if (!stream || !screenStream) {
      addLog("No stream available to record", "error");
      releaseAllStreams();
      setIsPreparing(false);
      setCountdown(null);
      return;
    }

    chunksRef.current = [];
    chunkCountRef.current = 0;
    const mime = MIME_TYPES.main;
    addLog(`Using video mime type: ${mime}`, "info");
    mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: mime });

    mediaRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
        chunkCountRef.current += 1;
        if (chunkCountRef.current === 1 || chunkCountRef.current % CHUNK_LOG_EVERY_N === 0) {
          addLog(`Data chunk ${chunkCountRef.current}: ${(e.data.size / 1024).toFixed(1)} KB`, "info");
        }
      }
    };

    const camStream = showCamera ? cameraStreamRef.current : null;
    if (camStream && camStream.getVideoTracks().length > 0) {
      cameraChunksRef.current = [];
      const camMime = MIME_TYPES.camera;
      addLog(`Using camera video mime type: ${camMime}`, "info");
      cameraRecorderRef.current = new MediaRecorder(camStream, { mimeType: camMime });
      cameraRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) cameraChunksRef.current.push(e.data);
      };
      cameraRecorderRef.current.onstop = () => {
        const camBlob = new Blob(cameraChunksRef.current, { type: camMime });
        recordedCameraBlobRef.current = camBlob;
        setRecordedCameraURL(URL.createObjectURL(camBlob));
        addLog(`Camera video ready: ${(camBlob.size / 1024).toFixed(1)} KB`, "success");
      };
      cameraRecorderRef.current.start(1000);
    }

    mediaRecorderRef.current.onstop = () => {
      addLog("Recording stopped, processing video...", "info");
      if (cameraRecorderRef.current && cameraRecorderRef.current.state !== "inactive") {
        if (cameraRecorderRef.current.state === "paused") {
          cameraRecorderRef.current.resume();
        }
        cameraRecorderRef.current.stop();
      }
      const blob = new Blob(chunksRef.current, { type: mime });
      const url = URL.createObjectURL(blob);
      setRecordedVideoURL(url);
      recordedBlobRef.current = blob;
      addLog(`Video ready! Size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`, "success");
      releaseAllStreams();
      setIsPaused(false);
      if (onRecordingStop) onRecordingStop(blob);
    };

    mediaRecorderRef.current.onerror = () => {
      addLog("Recording error – stopping and releasing microphone", "error");
      releaseAllStreams();
      setIsRecording(false);
      setIsPaused(false);
      if (onError) onError(new Error("MediaRecorder error"));
    };

    screenStream.getVideoTracks().forEach((track) => {
      track.onended = () => {
        addLog("Screen sharing stopped by browser – releasing microphone", "info");
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          if (mediaRecorderRef.current.state === "paused") {
            mediaRecorderRef.current.resume();
          }
          mediaRecorderRef.current.stop();
        }
        setIsRecording(false);
        setIsPaused(false);
      };
    });

    mediaRecorderRef.current.start(1000);
    setIsRecording(true);
    setIsPreparing(false);
    setCountdown(null);
    combinedStreamRef.current = null;
    addLog("Recording in progress...", "success");
    if (onRecordingStart) onRecordingStart();
  }, [
    addLog,
    releaseAllStreams,
    showCamera,
    onRecordingStop,
    onError,
    onRecordingStart,
  ]);

  const acquireStreamAndStartCountdown = useCallback(async () => {
    try {
      setScreenPermissionDeclined(false);
      setMicPermissionDeclined(false);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        const errMsg = "Screen recording is not supported on this browser or device (mobile browsers are not supported).";
        addLog(errMsg, "error");
        const error = new Error(errMsg);
        if (onError) onError(error);
        return;
      }

      addLog("Requesting screen capture...", "info");

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { mediaSource: "screen" } as MediaTrackConstraints,
        audio: true,
      });

      screenStreamRef.current = screenStream;
      addLog("Screen selected. Starting countdown...", "success");

      let videoStream: MediaStream = screenStream;
      if (showCamera && cameraEnabled) {
        let camStream = cameraStreamRef.current;
        if (!camStream) camStream = await requestCameraPermission();
        if (camStream) {
          videoStream = compositeScreenWithCamera(screenStream, camStream);
          addLog("Camera added as picture-in-picture", "success");
        }
      }

      const audioTracks: MediaStreamTrack[] = [];
      if (screenStream.getAudioTracks().length > 0) audioTracks.push(...screenStream.getAudioTracks());

      if (micEnabled) {
        const micStream = await requestMicPermission();
        if (micStream) {
          const screenAudioTracks = screenStream.getAudioTracks();
          const micAudioTracks = micStream.getAudioTracks();
          if (screenAudioTracks.length > 0 && micAudioTracks.length > 0) {
            try {
              const audioContext = new AudioContext();
              const screenAudioSource = audioContext.createMediaStreamSource(new MediaStream(screenAudioTracks));
              const micAudioSource = audioContext.createMediaStreamSource(micStream);
              const destination = audioContext.createMediaStreamDestination();
              screenAudioSource.connect(destination);
              micAudioSource.connect(destination);
              audioTracks.length = 0;
              audioTracks.push(...destination.stream.getAudioTracks());
              addLog("Screen and microphone audio combined", "success");
            } catch (audioErr) {
              const err = audioErr as Error;
              addLog(`Audio mixing failed: ${err.message}, using microphone only`, "info");
              audioTracks.length = 0;
              audioTracks.push(...micAudioTracks);
            }
          } else if (micAudioTracks.length > 0) {
            audioTracks.length = 0;
            audioTracks.push(...micAudioTracks);
            addLog("Using microphone audio only", "info");
          }
        } else {
          addLog("Recording without microphone audio", "info");
        }
      }

      const combinedStream =
        audioTracks.length > 0
          ? new MediaStream([...videoStream.getVideoTracks(), ...audioTracks])
          : new MediaStream(videoStream.getVideoTracks());
      combinedStreamRef.current = combinedStream;
      const seconds = Math.max(0, Math.min(10, countdownSeconds ?? 0));

      if (seconds > 0) {
        addLog(`Recording starts in ${seconds}...`, "info");
        setIsPreparing(true);
        setCountdown(seconds);
      } else {
        startMediaRecorderWithStream();
      }
    } catch (err) {
      const error = err as Error;
      addLog(`Error: ${error.message}`, "error");
      if (error.name === "NotAllowedError" || error.message?.includes("Permission") || error.message?.includes("denied")) {
        setScreenPermissionDeclined(true);
      }
      if (onError) onError(error);
      releaseAllStreams();
      setIsPreparing(false);
      setCountdown(null);
    }
  }, [
    addLog,
    cameraEnabled,
    countdownSeconds,
    micEnabled,
    onError,
    requestCameraPermission,
    requestMicPermission,
    showCamera,
    compositeScreenWithCamera,
    releaseAllStreams,
    startMediaRecorderWithStream,
  ]);

  const startRecording = useCallback(() => {
    acquireStreamAndStartCountdown();
  }, [acquireStreamAndStartCountdown]);

  const cancelCountdown = useCallback(() => {
    if (countdownTimeoutRef.current) {
      clearTimeout(countdownTimeoutRef.current);
      countdownTimeoutRef.current = null;
    }
    releaseAllStreams();
    setIsPreparing(false);
    setCountdown(null);
    setIsPaused(false);
    addLog("Countdown cancelled", "info");
  }, [releaseAllStreams, addLog]);

  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && !isPaused) {
      if (cameraRecorderRef.current?.state === "recording") {
        cameraRecorderRef.current.pause();
      }
      mediaRecorderRef.current.pause();
      setIsPaused(true);
      addLog("Recording paused", "info");
    }
  }, [isRecording, isPaused, addLog]);

  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording && isPaused) {
      if (cameraRecorderRef.current?.state === "paused") {
        cameraRecorderRef.current.resume();
      }
      mediaRecorderRef.current.resume();
      setIsPaused(false);
      addLog("Recording resumed", "info");
    }
  }, [isRecording, isPaused, addLog]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      if (cameraRecorderRef.current && cameraRecorderRef.current.state !== "inactive") {
        if (cameraRecorderRef.current.state === "paused") {
          cameraRecorderRef.current.resume();
        }
        cameraRecorderRef.current.stop();
      }
      if (mediaRecorderRef.current.state !== "inactive") {
        if (mediaRecorderRef.current.state === "paused") {
          mediaRecorderRef.current.resume();
        }
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      setIsPaused(false);
      addLog("Stop recording requested", "info");
    }
  }, [isRecording, addLog]);

  const triggerDownload = useCallback(
    (url: string, filename: string, logMessage: string, blob: Blob | null, onDownloadBlob?: (b: Blob) => void) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      addLog(logMessage, "success");
      if (blob && onDownloadBlob) onDownloadBlob(blob);
    },
    [addLog]
  );

  const downloadVideo = useCallback(() => {
    if (recordedVideoURL && recordedBlobRef.current) {
      triggerDownload(
        recordedVideoURL,
        `screen-recording-${Date.now()}.webm`,
        "Video download initiated",
        recordedBlobRef.current,
        onDownload ?? undefined
      );
    }
  }, [recordedVideoURL, onDownload, triggerDownload]);

  const downloadCameraVideo = useCallback(() => {
    if (recordedCameraURL && recordedCameraBlobRef.current) {
      triggerDownload(
        recordedCameraURL,
        `camera-recording-${Date.now()}.webm`,
        "Camera video download initiated",
        null
      );
    }
  }, [recordedCameraURL, triggerDownload]);

  const clearRecording = useCallback(() => {
    if (recordedVideoURL) {
      URL.revokeObjectURL(recordedVideoURL);
      setRecordedVideoURL(null);
      recordedBlobRef.current = null;
    }
    if (recordedCameraURL) {
      URL.revokeObjectURL(recordedCameraURL);
      setRecordedCameraURL(null);
      recordedCameraBlobRef.current = null;
    }
    addLog("Recording cleared", "info");
  }, [recordedVideoURL, recordedCameraURL, addLog]);

  const handleUpload = useCallback(() => {
    if (!recordedBlobRef.current) {
      addLog("No video to upload", "error");
      return;
    }

    addLog("Upload button clicked", "info");
    if (onUpload) {
      onUpload(recordedBlobRef.current);
    } else {
      addLog("No upload handler provided. Implement onUpload prop to handle uploads.", "info");
    }
  }, [onUpload, addLog]);

  const clearConsole = useCallback(() => {
    setConsoleLogs([]);
  }, []);

  const recordingStatusText = useMemo(
    () =>
      [
        micEnabled && hasMicPermission && "🎤 Mic",
        showCamera && cameraEnabled && hasCameraPermission && "📷 Camera",
      ]
        .filter(Boolean)
        .join(" · ") || "Screen only",
    [micEnabled, hasMicPermission, showCamera, cameraEnabled, hasCameraPermission]
  );

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);
    } else if (!isRecording) {
      setRecordingTime(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRecording, isPaused]);

  const formatTime = useCallback((seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const pad = (n: number) => n.toString().padStart(2, "0");
    
    if (hrs > 0) {
      return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    }
    return `${pad(mins)}:${pad(secs)}`;
  }, []);

  useEffect(() => {
    addLog("Screen Recorder initialized", "success");
    return () => {
      if (countdownTimeoutRef.current) clearTimeout(countdownTimeoutRef.current);
    };
  }, [addLog]);

  useEffect(() => {
    if (countdown === 0) {
      setCountdown(null);
      startMediaRecorderWithStream();
      return;
    }
    if (countdown === null || countdown <= 0) return;
    countdownTimeoutRef.current = setTimeout(() => {
      setCountdown((prev) => (prev !== null && prev > 0 ? prev - 1 : null));
      countdownTimeoutRef.current = null;
    }, 1000);
    return () => {
      if (countdownTimeoutRef.current) {
        clearTimeout(countdownTimeoutRef.current);
        countdownTimeoutRef.current = null;
      }
    };
    // startMediaRecorderWithStream is stable (refs/state); only run when countdown changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  useEffect(() => {
    const video = cameraPreviewRef.current;
    const stream = cameraStreamRef.current;
    if (video && stream && cameraEnabled && hasCameraPermission) {
      video.srcObject = stream;
      video.play().catch(() => { });
    } else if (video) {
      video.srcObject = null;
    }
  }, [cameraEnabled, hasCameraPermission]);

  useEffect(() => {
    return () => {
      if (recordedVideoURL) URL.revokeObjectURL(recordedVideoURL);
      if (recordedCameraURL) URL.revokeObjectURL(recordedCameraURL);
    };
  }, [recordedVideoURL, recordedCameraURL]);

  return (
    <div
      className={`onscreen-recorder-container ${!showHeader ? "onscreen-recorder-embed " : ""}${className}`.trim()}
    >
      {isPreparing && countdown !== null && (
        <div
          className="onscreen-recorder-countdown-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          aria-label={`Recording starts in ${countdown} seconds`}
        >
          <div className="onscreen-recorder-countdown-backdrop" />
          <div className="onscreen-recorder-countdown-content">
            <p className="onscreen-recorder-countdown-label">
              {countdown > 0 ? "Recording starts in" : ""}
            </p>
            <div className="onscreen-recorder-countdown-number" key={countdown}>
              {countdown > 0 ? countdown : "Go!"}
            </div>
            <p className="onscreen-recorder-countdown-hint">Screen selected – get ready</p>
            <button
              type="button"
              onClick={cancelCountdown}
              className="onscreen-recorder-button onscreen-recorder-button-secondary onscreen-recorder-countdown-cancel"
              aria-label="Cancel countdown"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="onscreen-recorder-wrapper">
        {showHeader && (
          <div className="onscreen-recorder-header">
            <h1 className="onscreen-recorder-title">
              <VideoIcon className="onscreen-recorder-title-icon" size={40} />
              Screen Recorder
            </h1>
            <p className="onscreen-recorder-subtitle">Record your screen with optional mic and camera</p>
          </div>
        )}

        <div className={`onscreen-recorder-grid ${showConsole ? "" : "onscreen-recorder-grid-single"}`}>
          {/* Recording Controls & Preview */}
          <div className="onscreen-recorder-card">
            <h2 className="onscreen-recorder-card-title">Recording</h2>
            <p className="onscreen-recorder-card-hint">
              {showCamera ? "Choose mic and camera, then start." : "Choose mic, then start."} You’ll pick the screen to share.
            </p>

            <div className="onscreen-recorder-controls">
              {screenPermissionDeclined && !isRecording && !isPreparing && (
                <div className="onscreen-recorder-permission-warning onscreen-recorder-fade-in">
                  <div className="onscreen-recorder-warning-header">
                    <span className="onscreen-recorder-warning-icon">⚠️</span>
                    <h3 className="onscreen-recorder-warning-title">Screen Sharing Blocked</h3>
                  </div>
                  <p className="onscreen-recorder-warning-text">
                    Screen sharing permission was declined. To record your screen, the browser needs permission.
                  </p>
                  <div className="onscreen-recorder-warning-steps">
                    <h4 className="onscreen-recorder-steps-title">How to enable permission again:</h4>
                    <ol className="onscreen-recorder-steps-list">
                      <li>
                        Click the <strong>lock icon</strong> (🔒) next to the URL in your browser's address bar.
                      </li>
                      <li>
                        Find <strong>Screen Sharing</strong> (or <strong>Screen</strong>) and set it to <strong>Allow</strong>.
                      </li>
                      <li>
                        Click <strong>Try Again</strong> below to start recording.
                      </li>
                    </ol>
                    <div className="onscreen-recorder-os-tip">
                      <strong>macOS Users:</strong> If permissions are allowed in the browser but recording still fails, open <strong>System Settings &gt; Privacy &amp; Security &gt; Screen Recording</strong> and ensure your browser is allowed.
                    </div>
                  </div>
                  <div className="onscreen-recorder-warning-actions">
                    <button
                      type="button"
                      onClick={startRecording}
                      className="onscreen-recorder-button onscreen-recorder-button-primary"
                    >
                      <PlayIcon className="onscreen-recorder-button-icon" size={20} />
                      Try Again
                    </button>
                    <button
                      type="button"
                      onClick={() => setScreenPermissionDeclined(false)}
                      className="onscreen-recorder-button onscreen-recorder-button-secondary"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {micPermissionDeclined && !isRecording && !isPreparing && (
                <div className="onscreen-recorder-permission-warning onscreen-recorder-fade-in">
                  <div className="onscreen-recorder-warning-header">
                    <span className="onscreen-recorder-warning-icon">🎤</span>
                    <h3 className="onscreen-recorder-warning-title">Microphone Access Blocked</h3>
                  </div>
                  <p className="onscreen-recorder-warning-text">
                    Microphone permission was declined. To record audio, the browser needs permission.
                  </p>
                  <div className="onscreen-recorder-warning-steps">
                    <h4 className="onscreen-recorder-steps-title">How to enable permission again:</h4>
                    <ol className="onscreen-recorder-steps-list">
                      <li>
                        Click the <strong>lock icon</strong> (🔒) next to the URL in your browser's address bar.
                      </li>
                      <li>
                        Find <strong>Microphone</strong> and set it to <strong>Allow</strong>.
                      </li>
                      <li>
                        Click <strong>Grant Permission</strong> below to re-request access.
                      </li>
                    </ol>
                    <div className="onscreen-recorder-os-tip">
                      <strong>macOS Users:</strong> If permissions are allowed in the browser but microphone audio still fails, open <strong>System Settings &gt; Privacy &amp; Security &gt; Microphone</strong> and ensure your browser is allowed.
                    </div>
                  </div>
                  <div className="onscreen-recorder-warning-actions">
                    <button
                      type="button"
                      onClick={async () => {
                        const stream = await requestMicPermission();
                        if (stream) {
                          setMicPermissionDeclined(false);
                          stream.getTracks().forEach((t) => t.stop());
                          micStreamRef.current = null;
                        }
                      }}
                      className="onscreen-recorder-button onscreen-recorder-button-primary"
                    >
                      <MicIcon className="onscreen-recorder-button-icon" size={20} />
                      Grant Permission
                    </button>
                    <button
                      type="button"
                      onClick={() => setMicPermissionDeclined(false)}
                      className="onscreen-recorder-button onscreen-recorder-button-secondary"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {!isRecording && !isPreparing && (
                <div className="onscreen-recorder-toggles">
                  <button
                    onClick={() => {
                      const next = !micEnabled;
                      setMicEnabled(next);
                      if (!next) {
                        setMicPermissionDeclined(false);
                      }
                    }}
                    className={`onscreen-recorder-toggle ${micEnabled ? "onscreen-recorder-toggle-on" : ""}`}
                    title={micEnabled ? "Microphone on" : "Microphone off"}
                    type="button"
                    aria-pressed={micEnabled}
                  >
                    {micEnabled ? <MicIcon size={18} /> : <MicOffIcon size={18} />}
                    <span>Mic</span>
                  </button>
                  {showCamera && (
                    <button
                      onClick={handleCameraButtonClick}
                      className={`onscreen-recorder-toggle ${cameraEnabled ? "onscreen-recorder-toggle-on" : ""}`}
                      title={cameraEnabled ? "Camera on" : "Enable camera"}
                      type="button"
                      aria-pressed={cameraEnabled}
                    >
                      {cameraEnabled ? <CameraIcon size={18} /> : <CameraOffIcon size={18} />}
                      <span>Camera</span>
                    </button>
                  )}
                </div>
              )}

              <div className="onscreen-recorder-button-group onscreen-recorder-actions">
                {!isRecording && !isPreparing ? (
                  <button onClick={startRecording} className="onscreen-recorder-button onscreen-recorder-button-primary" type="button">
                    <PlayIcon className="onscreen-recorder-button-icon" size={20} />
                    Start recording
                  </button>
                ) : isPreparing ? (
                  <div className="onscreen-recorder-preparing-indicator">
                    <div className="onscreen-recorder-preparing-dot" />
                    <p className="onscreen-recorder-preparing-text">Select your screen in the browser dialog…</p>
                  </div>
                ) : (
                  <>
                    {isPaused ? (
                      <button onClick={resumeRecording} className="onscreen-recorder-button onscreen-recorder-button-success" type="button">
                        <PlayIcon className="onscreen-recorder-button-icon" size={20} />
                        Resume
                      </button>
                    ) : (
                      <button onClick={pauseRecording} className="onscreen-recorder-button onscreen-recorder-button-warning" type="button">
                        <PauseIcon className="onscreen-recorder-button-icon" size={20} />
                        Pause
                      </button>
                    )}
                    <button onClick={stopRecording} className="onscreen-recorder-button onscreen-recorder-button-danger onscreen-recorder-recording" type="button">
                      <SquareIcon className="onscreen-recorder-button-icon" size={20} />
                      Stop recording
                    </button>
                  </>
                )}
              </div>

              {/* Camera live preview (when enabled, not recording) */}
              {showCamera && !isRecording && !isPreparing && cameraEnabled && hasCameraPermission && (
                <div className="onscreen-recorder-camera-preview onscreen-recorder-fade-in">
                  <p className="onscreen-recorder-camera-preview-label">Camera preview</p>
                  <video
                    ref={cameraPreviewRef}
                    className="onscreen-recorder-camera-preview-video"
                    muted
                    playsInline
                    aria-label="Camera preview"
                  />
                </div>
              )}

              {/* Screen + PiP recorded video */}
              {recordedVideoURL && (
                <div className="onscreen-recorder-video-section onscreen-recorder-fade-in">
                  <h3 className="onscreen-recorder-video-title">Screen recording</h3>
                  <video ref={videoRef} src={recordedVideoURL} controls className="onscreen-recorder-video" />

                  <div className="onscreen-recorder-toolbar" role="toolbar" aria-label="Recording actions">
                    <button onClick={downloadVideo} className="onscreen-recorder-button onscreen-recorder-button-success" type="button">
                      <DownloadIcon className="onscreen-recorder-button-icon" size={16} />
                      Download screen
                    </button>
                    {recordedCameraURL && (
                      <button onClick={downloadCameraVideo} className="onscreen-recorder-button onscreen-recorder-button-success" type="button">
                        <CameraIcon className="onscreen-recorder-button-icon" size={16} />
                        Download camera
                      </button>
                    )}
                    {onUpload && (
                      <button onClick={handleUpload} className="onscreen-recorder-button onscreen-recorder-button-purple" type="button">
                        <UploadIcon className="onscreen-recorder-button-icon" size={16} />
                        Upload
                      </button>
                    )}
                    <button onClick={clearRecording} className="onscreen-recorder-button onscreen-recorder-button-secondary" type="button">
                      <TrashIcon className="onscreen-recorder-button-icon" size={16} />
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Camera-only recorded video */}
              {recordedCameraURL && (
                <div className="onscreen-recorder-video-section onscreen-recorder-camera-section">
                  <h3 className="onscreen-recorder-video-title">Camera recording</h3>
                  <video ref={cameraVideoRef} src={recordedCameraURL} controls className="onscreen-recorder-video" />
                </div>
              )}

              {!recordedVideoURL && !isRecording && !isPreparing && (
                <div className="onscreen-recorder-empty-state">
                  <VideoIcon className="onscreen-recorder-empty-icon" size={48} aria-hidden />
                  <p className="onscreen-recorder-empty-text">No recording yet</p>
                  <p className="onscreen-recorder-empty-subtext">Use the options above and click Start recording</p>
                </div>
              )}

              {isRecording && (
                <div className="onscreen-recorder-recording-indicator onscreen-recorder-fade-in">
                  <div className={`onscreen-recorder-recording-dot ${isPaused ? "onscreen-recorder-paused-dot" : ""}`} style={isPaused ? { animation: "none", backgroundColor: "#f59e0b", boxShadow: "0 0 20px #f59e0b" } : undefined} />
                  <div className="onscreen-recorder-recording-time">{formatTime(recordingTime)}</div>
                  <p className="onscreen-recorder-recording-text">{isPaused ? "Paused" : "Recording…"}</p>
                  <p className="onscreen-recorder-recording-subtext">{recordingStatusText}</p>
                </div>
              )}
            </div>
          </div>

          {showConsole && (
            <div className="onscreen-recorder-card">
              <div className="onscreen-recorder-console-header">
                <h2 className="onscreen-recorder-card-title">Console</h2>
                <button onClick={clearConsole} className="onscreen-recorder-button-small" type="button">
                  Clear
                </button>
              </div>
              <div className="onscreen-recorder-console">
                {consoleLogs.length === 0 ? (
                  <p className="onscreen-recorder-console-empty">Logs appear here when enabled.</p>
                ) : (
                  <div className="onscreen-recorder-logs">
                    {consoleLogs.map((log, index) => (
                      <div key={index} className="onscreen-recorder-log">
                        <span className="onscreen-recorder-log-timestamp">[{log.timestamp}]</span>
                        <span className={logIconClass(log.type)}>{LOG_ICON[log.type]}</span>
                        <span className={logMsgClass(log.type)}>{log.message}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const ScreenRecorder = memo(ScreenRecorderComponent);
