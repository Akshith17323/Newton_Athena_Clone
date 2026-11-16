const MEBIBYTE = 1024 * 1024;

export const SNAPSHOT_POLICY = Object.freeze({
    intervalMs: 5000,
    minCaptureIntervalMs: 4500,
    maxWidth: 1280,
    maxHeight: 720,
    jpegQuality: 75,
    maxImageBytes: 2 * MEBIBYTE,
    maxStorageBytes: 512 * MEBIBYTE,
    maxFiles: 5000,
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    minFreeBytes: 256 * MEBIBYTE,
    scanIntervalMs: 60000,
    operationTimeoutMs: 15000
});

export function getSnapshotDimensions(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        throw new Error('Snapshot dimensions must be positive numbers.');
    }

    const scale = Math.min(1, SNAPSHOT_POLICY.maxWidth / width, SNAPSHOT_POLICY.maxHeight / height);
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale))
    };
}
