// MediaStream is a global type in DOM

export interface ConsoleLog {
  message: string;
  type: "info" | "success" | "error";
  timestamp: string;
}

export interface Toast {
  id: number;
  message: string;
  type: "info" | "success" | "error";
}

export interface RecordingState {
  isRecording: boolean;
  recordedVideoURL: string | null;
  consoleLogs: ConsoleLog[];
  isUploading: boolean;
  apiEndpoint: string;
  toasts: Toast[];
  micEnabled: boolean;
  hasMicPermission: boolean;
}

export interface RecordingRefs {
  mediaRecorder: MediaRecorder | null;
  chunks: Blob[];
  video: HTMLVideoElement | null;
  recordedBlob: Blob | null;
  toastTimeouts: ReturnType<typeof setTimeout>[];
  micStream: MediaStream | null;
}

/**
 * Adds a log entry to the console logs
 */
export const addLog = (
  setConsoleLogs: React.Dispatch<React.SetStateAction<ConsoleLog[]>>,
  message: string,
  type: "info" | "success" | "error" = "info"
): void => {
  const timestamp = new Date().toLocaleTimeString();
  setConsoleLogs((prev) => [...prev, { message, type, timestamp }]);
};

/**
 * Shows a toast notification
 */
export const showToast = (
  setToasts: React.Dispatch<React.SetStateAction<Toast[]>>,
  toastTimeoutsRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>,
  message: string,
  type: "info" | "success" | "error" = "info"
): void => {
  const id = Date.now();
  setToasts((prev) => [...prev, { id, message, type }]);

  const timeout = setTimeout(() => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, 4000);

  toastTimeoutsRef.current.push(timeout);
};

/**
 * Removes a toast notification by ID
 */
export const removeToast = (
  setToasts: React.Dispatch<React.SetStateAction<Toast[]>>,
  id: number
): void => {
  setToasts((prev) => prev.filter((toast) => toast.id !== id));
};

/**
 * Shows recording-related toast notifications
 */
export const showRecordingToasts = (
  setToasts: React.Dispatch<React.SetStateAction<Toast[]>>,
  toastTimeoutsRef: React.MutableRefObject<ReturnType<typeof setTimeout>[]>,
  micEnabled: boolean
): void => {
  const messages = [
    { text: "🎬 Recording started successfully!", type: "success" as const },
    { text: "📹 Capturing your screen in high quality", type: "info" as const },
    {
      text: micEnabled ? "🎤 Microphone audio is being recorded" : "🔇 Recording without microphone",
      type: "info" as const,
    },
    { text: "💾 Video chunks are being saved", type: "info" as const },
    { text: "⏱️ Recording time is unlimited", type: "success" as const },
  ];

  messages.forEach((msg, index) => {
    setTimeout(() => {
      showToast(setToasts, toastTimeoutsRef, msg.text, msg.type);
    }, index * 5000);
  });
};

/**
 * Requests microphone permission
 */
export const requestMicPermission = async (
  setHasMicPermission: React.Dispatch<React.SetStateAction<boolean>>,
  micStreamRef: React.MutableRefObject<MediaStream | null>,
  addLogFn: (message: string, type?: "info" | "success" | "error") => void,
  showToastFn: (message: string, type?: "info" | "success" | "error") => void
): Promise<MediaStream | null> => {
  try {
    addLogFn("Requesting microphone permission...", "info");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    setHasMicPermission(true);
    addLogFn("Microphone permission granted", "success");
    showToastFn("🎤 Microphone access granted!", "success");
    return stream;
  } catch (err) {
    const error = err as Error;
    addLogFn(`Microphone permission denied: ${error.message}`, "error");
    showToastFn("❌ Microphone access denied", "error");
    setHasMicPermission(false);
    return null;
  }
};

/**
 * Combines screen and microphone audio streams
 */
export const combineAudioStreams = (
  screenStream: MediaStream,
  micStream: MediaStream
): MediaStream => {
  const screenAudioTracks = screenStream.getAudioTracks();
  const micAudioTracks = micStream.getAudioTracks();
  const videoTracks = screenStream.getVideoTracks();

  if (screenAudioTracks.length > 0 && micAudioTracks.length > 0) {
    // Both screen and mic have audio - mix them
    try {
      const audioContext = new AudioContext();
      const screenAudioSource = audioContext.createMediaStreamSource(new MediaStream(screenAudioTracks));
      const micAudioSource = audioContext.createMediaStreamSource(micStream);
      const destination = audioContext.createMediaStreamDestination();

      screenAudioSource.connect(destination);
      micAudioSource.connect(destination);

      return new MediaStream([...videoTracks, ...destination.stream.getAudioTracks()]);
    } catch {
      // Fallback to microphone only if mixing fails
      return new MediaStream([...videoTracks, ...micAudioTracks]);
    }
  } else if (micAudioTracks.length > 0) {
    // Only mic has audio
    return new MediaStream([...videoTracks, ...micAudioTracks]);
  } else if (screenAudioTracks.length > 0) {
    // Only screen has audio
    return new MediaStream([...videoTracks, ...screenAudioTracks]);
  } else {
    // No audio at all
    return new MediaStream(videoTracks);
  }
};

/**
 * Downloads a video blob
 */
export const downloadVideo = (
  recordedVideoURL: string | null,
  addLogFn: (message: string, type?: "info" | "success" | "error") => void
): void => {
  if (recordedVideoURL) {
    const a = document.createElement("a");
    a.href = recordedVideoURL;
    a.download = `screen-recording-${Date.now()}.webm`;
    a.click();
    addLogFn("Video download initiated", "success");
  }
};

/**
 * Clears the recorded video
 */
export const clearRecording = (
  recordedVideoURL: string | null,
  setRecordedVideoURL: React.Dispatch<React.SetStateAction<string | null>>,
  recordedBlobRef: React.MutableRefObject<Blob | null>,
  addLogFn: (message: string, type?: "info" | "success" | "error") => void
): void => {
  if (recordedVideoURL) {
    URL.revokeObjectURL(recordedVideoURL);
    setRecordedVideoURL(null);
    recordedBlobRef.current = null;
    addLogFn("Recording cleared", "info");
  }
};

/**
 * Uploads video to API endpoint
 */
export const uploadToAPI = async (
  recordedBlobRef: React.MutableRefObject<Blob | null>,
  apiEndpoint: string,
  setIsUploading: React.Dispatch<React.SetStateAction<boolean>>,
  addLogFn: (message: string, type?: "info" | "success" | "error") => void
): Promise<void> => {
  if (!recordedBlobRef.current) {
    addLogFn("No video to upload", "error");
    return;
  }

  setIsUploading(true);
  addLogFn(`Starting upload to: ${apiEndpoint}`, "info");

  try {
    const formData = new FormData();
    const filename = `screen-recording-${Date.now()}.webm`;
    formData.append("video", recordedBlobRef.current, filename);
    formData.append("timestamp", new Date().toISOString());
    formData.append("size", recordedBlobRef.current.size.toString());

    addLogFn("Sending request...", "info");

    const response = await fetch(apiEndpoint, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      const result = await response.json();
      addLogFn(`Upload successful! Status: ${response.status}`, "success");
      addLogFn(`Response: ${JSON.stringify(result).substring(0, 200)}...`, "success");
    } else {
      addLogFn(`Upload failed! Status: ${response.status}`, "error");
    }
  } catch (error) {
    const err = error as Error;
    addLogFn(`Upload error: ${err.message}`, "error");
  } finally {
    setIsUploading(false);
  }
};
