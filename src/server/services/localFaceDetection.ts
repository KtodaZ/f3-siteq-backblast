/**
 * Local Face Detection Service
 * 
 * ⚠️  IMPORTANT: This file duplicates core logic from lambda/detectFaces.js
 * 
 * This service extracts the face detection logic from AWS Lambda for local development.
 * When making changes to detection algorithms, preprocessing, or database updates,
 * ensure BOTH files are kept in sync:
 * 
 * - src/server/services/localFaceDetection.ts (this file) - for local development
 * - lambda/detectFaces.js - for AWS Lambda deployment
 * 
 * The main differences:
 * - This file integrates directly with Next.js app and local database
 * - Lambda version includes AWS Lambda handler wrapper
 * - Both use identical face detection and preprocessing logic
 */

import { RekognitionClient, DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { readFile } from "fs/promises";
import { join } from "path";
import { env } from "~/env";
import { db } from "~/server/db";
import { photos, photoFaces } from "~/server/db/schema";

// Initialize AWS clients
const rekognitionClient = new RekognitionClient({
  region: env.AWS_REGION ?? "us-east-1",
  credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

const s3Client = new S3Client({
  region: env.AWS_REGION ?? "us-east-1",
  credentials: env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  } : undefined,
});

export interface FaceDetectionResult {
  success: boolean;
  photoId: number;
  facesDetected: number;
  message: string;
  error?: string;
}

/**
 * Preprocess image for optimal group photo face detection
 */
async function preprocessImageForFaceDetection(imageBuffer: Buffer) {
  try {
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`Original image: ${metadata.width}x${metadata.height}, size: ${imageBuffer.length} bytes`);
    
    // Group photo optimizations - all photos are group photos
    let processor = sharp(imageBuffer)
      .normalize() // Improve contrast and brightness
      .sharpen(1.5) // Enhance edge definition for small faces
      .gamma(1.1); // Slightly brighten for better face visibility
      
    // Ensure minimum resolution for small faces (min 40x40 pixels per face)
    if (metadata.width && metadata.width < 1600) {
      processor = processor.resize(1600, null, { 
        withoutEnlargement: true,
        kernel: sharp.kernel.lanczos3 // High-quality resampling
      });
    }
    
    // Convert to JPEG for consistent processing
    const processedBuffer = await processor
      .jpeg({ quality: 95, mozjpeg: true })
      .toBuffer();
      
    const processedMetadata = await sharp(processedBuffer).metadata();
    console.log(`Processed image: ${processedMetadata.width}x${processedMetadata.height}, size: ${processedBuffer.length} bytes`);
    
    return {
      buffer: processedBuffer,
      enhanced: true,
      originalSize: { width: metadata.width, height: metadata.height },
      processedSize: { width: processedMetadata.width, height: processedMetadata.height }
    };
  } catch (error) {
    console.warn("Image preprocessing failed, using original:", error instanceof Error ? error.message : "Unknown error");
    return {
      buffer: imageBuffer,
      enhanced: false,
      originalSize: null,
      processedSize: null
    };
  }
}

/**
 * Get image buffer from S3
 */
async function getImageBuffer(s3Key: string): Promise<Buffer> {
  if (!env.S3_BUCKET_NAME) {
    throw new Error("S3_BUCKET_NAME not configured");
  }
  
  const getObjectCommand = new GetObjectCommand({
    Bucket: env.S3_BUCKET_NAME,
    Key: s3Key,
  });

  const s3Response = await s3Client.send(getObjectCommand);
  if (!s3Response.Body) {
    throw new Error("Failed to retrieve image from S3");
  }
  
  return Buffer.from(await s3Response.Body.transformToByteArray());
}

/**
 * Mark photo processing as failed
 */
async function markProcessingFailed(photoId: number, error: Error): Promise<void> {
  try {
    await db.update(photos)
      .set({ 
        processingStatus: "failed",
        lastError: error.message 
      })
      .where(eq(photos.id, photoId));
  } catch (dbError) {
    console.error("Failed to mark processing as failed:", dbError);
  }
}

/**
 * Robust photo processing with retry logic
 */
async function robustPhotoProcessing(photoId: number, s3Key: string, maxRetries = 3): Promise<FaceDetectionResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Face detection attempt ${attempt} for photo ${photoId}`);
      
      const result = await processPhoto(photoId, s3Key);
      if (result.success) {
        return result;
      }
      
      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(`Retrying in ${backoffMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error);
      
      // Update processing attempts in database
      try {
        await db.update(photos)
          .set({ processingAttempts: attempt })
          .where(eq(photos.id, photoId));
      } catch (dbError) {
        console.error("Failed to update processing attempts:", dbError);
      }
      
      if (attempt === maxRetries) {
        await markProcessingFailed(photoId, error instanceof Error ? error : new Error("Unknown error"));
        throw error;
      }
    }
  }

  throw new Error("Failed to process photo after all retries");
}

/**
 * Core photo processing logic
 */
async function processPhoto(photoId: number, s3Key: string): Promise<FaceDetectionResult> {
  // Start transaction for atomic operations
  return await db.transaction(async (tx) => {
    try {
      // Get image buffer from S3 or local file system
      const originalImageBytes = await getImageBuffer(s3Key);

      // Preprocess image for optimal group photo face detection
      const preprocessResult = await preprocessImageForFaceDetection(originalImageBytes);
      const imageBytes = preprocessResult.buffer;

      console.log(`Using ${preprocessResult.enhanced ? 'enhanced' : 'original'} image for face detection`);

      // Detect faces using Rekognition with optimized settings for group photos
      const detectFacesCommand = new DetectFacesCommand({
        Image: {
          Bytes: imageBytes,
        },
        Attributes: ["ALL"], // Get detailed face attributes
      });

      const rekognitionResponse = await rekognitionClient.send(detectFacesCommand);
      const faces = rekognitionResponse.FaceDetails || [];

      console.log(`Detected ${faces.length} faces in photo ${photoId}`);

      // Calculate quality metrics for new schema fields
      const imageMetadata = preprocessResult.originalSize;
      const averageFaceSize = faces.length > 0 
        ? faces.reduce((sum, face) => {
            const faceWidth = face.BoundingBox?.Width || 0;
            const faceHeight = face.BoundingBox?.Height || 0;
            const imageWidth = imageMetadata?.width || 1;
            const imageHeight = imageMetadata?.height || 1;
            return sum + (faceWidth * imageWidth * faceHeight * imageHeight);
          }, 0) / faces.length
        : 0;

      // Store face detection results in database
      const photoFaceRecords = faces.map((face, index) => {
        const boundingBox = face.BoundingBox;
        const faceWidth = boundingBox?.Width || 0;
        const faceHeight = boundingBox?.Height || 0;
        const imageWidth = imageMetadata?.width || 1;
        const imageHeight = imageMetadata?.height || 1;
        const faceSize = faceWidth * imageWidth * faceHeight * imageHeight;
        
        // Calculate bounding box quality based on size and position
        const boundingBoxQuality = Math.min(100, (faceSize / 2500) * 50 + 50); // 50x50 = decent quality
        
        return {
          photoId: photoId,
          awsFaceId: `detected-${photoId}-${index}`,
          confidence: face.Confidence || 0,
          boundingBox: {
            left: boundingBox?.Left || 0,
            top: boundingBox?.Top || 0,
            width: faceWidth,
            height: faceHeight,
          },
          isConfirmed: false,
          // New schema fields
          faceQuality: face.Quality?.Brightness ? 
            (face.Quality.Brightness + (face.Quality.Sharpness || 0)) / 2 : face.Confidence,
          detectionMethod: "group_photo_enhanced",
          reviewStatus: "pending",
          boundingBoxQuality: boundingBoxQuality,
          faceSize: faceSize,
        };
      });

      // Update photo record with face count and processing status + new metadata fields
      await tx.update(photos)
        .set({ 
          processingStatus: "completed", 
          faceCount: faces.length,
          // New schema fields
          imageWidth: imageMetadata?.width || null,
          imageHeight: imageMetadata?.height || null,
          averageFaceSize: averageFaceSize,
          preprocessed: preprocessResult.enhanced,
          enhancementApplied: preprocessResult.enhanced ? "group_photo_optimization" : null,
        })
        .where(eq(photos.id, photoId));

      // Insert detected faces using secure parameterized queries
      if (photoFaceRecords.length > 0) {
        await tx.insert(photoFaces).values(photoFaceRecords);
      }

      // Return success result (transaction commits automatically)
      return {
        success: true,
        photoId: photoId,
        facesDetected: faces.length,
        message: `Successfully detected ${faces.length} faces`,
      };
    } catch (error) {
      console.error("Photo processing error:", error);
      throw error;
    }
  }); // End transaction
}

/**
 * Detect faces in a photo using AWS Rekognition
 */
export async function detectFacesInPhoto(photoId: number, s3Key: string): Promise<FaceDetectionResult> {
  try {
    console.log(`Starting face detection for photo ${photoId} with key ${s3Key}`);

    // Check if AWS Rekognition is configured
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials not configured for face detection");
    }

    // Use robust processing with retries
    const result = await robustPhotoProcessing(photoId, s3Key);
    return result;

  } catch (error) {
    console.error("Face detection error:", error);
    return {
      success: false,
      photoId: photoId,
      facesDetected: 0,
      message: "Face detection failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if face detection is properly configured
 */
export function isFaceDetectionConfigured(): boolean {
  return !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION);
}