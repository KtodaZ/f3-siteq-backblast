import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/env";

// Create S3 client with AWS credentials
const s3Client = new S3Client({
  region: env.AWS_REGION ?? "us-east-1",
  credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

const BUCKET_NAME = env.S3_BUCKET_NAME ?? "f3-face-recognition-photos";

export interface UploadResult {
  key: string;
  bucket: string;
}

/**
 * Upload a file buffer to S3
 */
export async function uploadToS3(
  buffer: Buffer,
  fileName: string,
  contentType: string,
  userId?: string
): Promise<UploadResult> {
  // Generate unique key with timestamp and user ID
  const timestamp = Date.now();
  const cleanFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const key = userId 
    ? `users/${userId}/${timestamp}-${cleanFileName}`
    : `uploads/${timestamp}-${cleanFileName}`;

  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // Add metadata for face recognition processing
      Metadata: {
        uploadedAt: new Date().toISOString(),
        originalFileName: fileName,
        userId: userId ?? "anonymous",
      },
    });

    await s3Client.send(command);

    return {
      key,
      bucket: BUCKET_NAME,
    };
  } catch (error) {
    console.error("S3 upload error:", error);
    throw new Error(`Failed to upload to S3: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}

/**
 * Get a presigned URL for secure access to S3 object
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error("Failed to generate presigned URL:", error);
    throw new Error("Failed to generate presigned URL");
  }
}

/**
 * Delete an object from S3
 */
export async function deleteFromS3(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
  } catch (error) {
    console.error("Failed to delete from S3:", error);
    throw new Error("Failed to delete from S3");
  }
}

/**
 * Check if S3 is properly configured
 */
export function isS3Configured(): boolean {
  return !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.S3_BUCKET_NAME);
}

/**
 * Generate optimized image key for different sizes
 */
export function generateImageKey(originalKey: string, size: "thumbnail" | "medium" | "large"): string {
  const pathParts = originalKey.split("/");
  const filename = pathParts.pop();
  const path = pathParts.join("/");
  
  if (!filename) {
    throw new Error("Invalid key: no filename found");
  }
  
  const [name, ext] = filename.split(".");
  return `${path}/${name}-${size}.${ext || "jpg"}`;
}