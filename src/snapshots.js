import { getSnapshotDimensions, SNAPSHOT_POLICY } from '../app/snapshot-policy.js';

export async function captureCameraFrame(video) {
  if (!video?.srcObject || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return null;
  const track = video.srcObject.getVideoTracks()[0];
  if (!track || track.readyState === 'ended') return null;

  // Encode a bounded video frame in the renderer, not a full-resolution still photo.
  const canvas = document.createElement('canvas');
  const dimensions = getSnapshotDimensions(video.videoWidth, video.videoHeight);
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Cannot prepare a webcam snapshot.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', SNAPSHOT_POLICY.jpegQuality / 100);
  });
  if (!blob || blob.size === 0 || blob.size > SNAPSHOT_POLICY.maxImageBytes) {
    throw new Error('Webcam snapshot is empty or exceeds the image size limit.');
  }
  return await blob.arrayBuffer();
}

export function createSnapshotCaptureRunner({ timeoutMs = SNAPSHOT_POLICY.operationTimeoutMs } = {}) {
  const inFlight = new Set();
  return async (kind, capture, onSlowCapture = () => {}) => {
    if (inFlight.has(kind)) return null;
    inFlight.add(kind);
    const timeout = setTimeout(onSlowCapture, timeoutMs);
    try {
      return await capture();
    } finally {
      clearTimeout(timeout);
      // Do not release a slot on timeout: canvas encoding/IPC may still be pending.
      inFlight.delete(kind);
    }
  };
}
