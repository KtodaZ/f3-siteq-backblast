/**
 * AWS Lambda function for face detection using AWS Rekognition
 * 
 * ⚠️  IMPORTANT: This file's core logic is duplicated in src/server/services/localFaceDetection.ts
 * 
 * This function processes uploaded photos to detect faces and store
 * the face data in the database for recognition.
 * 
 * When making changes to detection algorithms, preprocessing, or database updates,
 * ensure BOTH files are kept in sync:
 * 
 * - lambda/detectFaces.js (this file) - for AWS Lambda deployment
 * - src/server/services/localFaceDetection.ts - for local development
 * 
 * The main differences:
 * - This file includes AWS Lambda handler wrapper for cloud deployment
 * - Local version integrates directly with Next.js app
 * - Both use identical face detection and preprocessing logic
 */

import { RekognitionClient, DetectFacesCommand } from "@aws-sdk/client-rekognition";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import sharp from "sharp";

// Import schema definitions (needs to be copied from main project)
import { createTable } from "drizzle-orm/pg-core";
import { pgTableCreator, serial, varchar, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";

// Schema definitions (copied from main project)
const createTableWithPrefix = pgTableCreator((name) => `f3-siteq-backblast_${name}`);

const photos = createTableWithPrefix("photos", {
  id: serial("id").primaryKey(),
  filename: varchar("filename", { length: 255 }).notNull(),
  s3Key: varchar("s3_key", { length: 500 }).notNull(),
  uploadDate: timestamp("upload_date").defaultNow(),
  processingStatus: varchar("processing_status", { length: 50 }).default("pending"),
  faceCount: integer("face_count").default(0),
  processingAttempts: integer("processing_attempts").default(0),
  lastError: varchar("last_error", { length: 1000 }),
});

const photoFaces = createTableWithPrefix("photo_faces", {
  id: serial("id").primaryKey(),
  photoId: integer("photo_id").references(() => photos.id),
  personId: integer("person_id"),
  awsFaceId: varchar("aws_face_id", { length: 255 }),
  confidence: real("confidence"),
  boundingBox: jsonb("bounding_box"),
  isConfirmed: boolean("is_confirmed").default(false),
});

// Initialize AWS clients
const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// Initialize database connection
const connectionString = process.env.DATABASE_URL;
const client = postgres(connectionString, { prepare: false });
const db = drizzle(client);

/**
 * Preprocess image for optimal group photo face detection
 */
async function preprocessImageForFaceDetection(imageBuffer) {
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
    console.warn("Image preprocessing failed, using original:", error.message);
    return {
      buffer: imageBuffer,
      enhanced: false,
      originalSize: null,
      processedSize: null
    };
  }
}


/**
 * Robust photo processing with retry logic
 */
async function robustPhotoProcessing(photoId, s3Key, bucketName, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Face detection attempt ${attempt} for photo ${photoId}`);
      
      const result = await processPhoto(photoId, s3Key, bucketName);
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
          .where(eq(photos.id, parseInt(photoId)));
      } catch (dbError) {
        console.error("Failed to update processing attempts:", dbError);
      }
      
      if (attempt === maxRetries) {
        await markProcessingFailed(photoId, error);
        throw error;
      }
    }
  }
}

/**
 * Mark photo processing as failed
 */
async function markProcessingFailed(photoId, error) {
  try {
    await db.update(photos)
      .set({ 
        processingStatus: "failed",
        lastError: error.message 
      })
      .where(eq(photos.id, parseInt(photoId)));
  } catch (dbError) {
    console.error("Failed to mark processing as failed:", dbError);
  }
}

/**
 * Main Lambda handler with error handling
 */
export const handler = async (event) => {
  try {
    console.log("Face detection started for event:", JSON.stringify(event));

    const { photoId, s3Key, bucketName } = event;

    if (!photoId || !s3Key || !bucketName) {
      throw new Error("Missing required parameters: photoId, s3Key, bucketName");
    }

    // Use robust processing with retries
    const result = await robustPhotoProcessing(photoId, s3Key, bucketName);
    return result;

  } catch (error) {
    console.error("Face detection handler error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message,
        photoId: event.photoId,
      }),
    };
  } finally {
    // Close database connection
    await client.end();
  }
};

/**
 * Core photo processing logic
 */
async function processPhoto(photoId, s3Key, bucketName) {
  // Start transaction for atomic operations
  return await db.transaction(async (tx) => {
    // Get image from S3
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const s3Response = await s3Client.send(getObjectCommand);
    const originalImageBytes = await s3Response.Body.transformToByteArray();

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

    // Store face detection results in database
    const photoFaceRecords = faces.map((face, index) => ({
      photoId: parseInt(photoId),
      awsFaceId: `detected-${photoId}-${index}`,
      confidence: face.Confidence,
      boundingBox: {
        left: face.BoundingBox.Left,
        top: face.BoundingBox.Top,
        width: face.BoundingBox.Width,
        height: face.BoundingBox.Height,
      },
      isConfirmed: false,
    }));

    // Update photo record with face count and processing status using secure Drizzle ORM
    await tx.update(photos)
      .set({ 
        processingStatus: "completed", 
        faceCount: faces.length 
      })
      .where(eq(photos.id, parseInt(photoId)));

    // Insert detected faces using secure parameterized queries
    if (photoFaceRecords.length > 0) {
      await tx.insert(photoFaces).values(photoFaceRecords.map(face => ({
        photoId: face.photoId,
        awsFaceId: face.awsFaceId,
        confidence: face.confidence,
        boundingBox: face.boundingBox,
        isConfirmed: face.isConfirmed,
      })));
    }

    // Return success result (transaction commits automatically)
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        photoId: photoId,
        facesDetected: faces.length,
        message: `Successfully detected ${faces.length} faces`,
      }),
    };
  }); // End transaction
}