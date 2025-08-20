/**
 * Local Face Recognition Service
 * 
 * ⚠️  IMPORTANT: This file duplicates core logic from lambda/recognizeFaces.js
 * 
 * This service extracts the face recognition logic from AWS Lambda for local development.
 * When making changes to recognition algorithms, confidence thresholds, or database updates,
 * ensure BOTH files are kept in sync:
 * 
 * - src/server/services/localFaceRecognition.ts (this file) - for local development
 * - lambda/recognizeFaces.js - for AWS Lambda deployment
 * 
 * The main differences:
 * - This file integrates directly with Next.js app and local database
 * - Lambda version includes AWS Lambda handler wrapper
 * - Both use identical face recognition and matching logic
 */

import { RekognitionClient, SearchFacesByImageCommand, IndexFacesCommand } from "@aws-sdk/client-rekognition";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { eq, and } from "drizzle-orm";
import { readFile } from "fs/promises";
import { join } from "path";
import { env } from "~/env";
import { db } from "~/server/db";
import { faceEncodings, photoFaces } from "~/server/db/schema";

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

export interface FaceRecognitionResult {
  success: boolean;
  photoId: number;
  facesRecognized: number;
  facesNeedingReview: number;
  totalMatches: number;
  photoType: string;
  thresholdUsed: number;
  results: Array<{
    personId: number;
    confidence: number;
    faceId: string;
    status: string;
    needsReview: boolean;
  }>;
  reviewQueue: Array<{
    personId: number;
    confidence: number;
    faceId: string;
    status: string;
    needsReview: boolean;
  }>;
  message: string;
  error?: string;
}

export interface IndexFaceResult {
  success: boolean;
  awsFaceId?: string;
  personId?: number;
  confidence?: number;
  error?: string;
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
 * Robust face recognition with retry logic
 */
async function robustFaceRecognition(photoId: number, s3Key: string, collectionId: string, maxRetries = 3): Promise<FaceRecognitionResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Face recognition attempt ${attempt} for photo ${photoId}`);
      
      const result = await processPhotoRecognition(photoId, s3Key, collectionId);
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
      
      if (attempt === maxRetries) {
        throw error;
      }
    }
  }

  throw new Error("Failed to process face recognition after all retries");
}

/**
 * Core photo recognition processing logic
 */
async function processPhotoRecognition(photoId: number, s3Key: string, collectionId: string): Promise<FaceRecognitionResult> {
  // Start transaction for atomic operations
  return await db.transaction(async (tx) => {
    try {
      // Get image buffer from S3 or local file system
      const imageBytes = await getImageBuffer(s3Key);

      // All photos are group photos - use optimized thresholds
      const faceMatchThreshold = 60; // Lower threshold for group photos
      const conservativeThreshold = 75; // Conservative threshold for final results
      
      console.log(`Processing group photo with threshold ${faceMatchThreshold}%`);

      // Search for faces in the Rekognition collection with adaptive threshold
      const searchCommand = new SearchFacesByImageCommand({
        CollectionId: collectionId,
        Image: {
          Bytes: imageBytes,
        },
        MaxFaces: 30, // Increased for group photos
        FaceMatchThreshold: faceMatchThreshold, // Adaptive confidence threshold
      });

      const searchResponse = await rekognitionClient.send(searchCommand);
      const faceMatches = searchResponse.FaceMatches || [];
      // Note: SearchFacesByImage doesn't return a SearchedFace property in newer SDK versions

      console.log(`Found ${faceMatches.length} face matches for photo ${photoId}`);

      // Process face matches and update database with confidence-based handling
      const recognitionResults = [];
      const manualReviewQueue = [];

      for (const match of faceMatches) {
        const faceId = match.Face?.FaceId;
        const confidence = match.Similarity || 0;

        if (!faceId) continue;

        // Look up person ID from face_encodings table using secure Drizzle ORM
        const personRecord = await tx.query.faceEncodings.findFirst({
          where: eq(faceEncodings.awsFaceId, faceId),
          columns: { personId: true },
        });

        if (personRecord?.personId) {
          const personId = personRecord.personId;
          
          // Determine recognition status based on confidence level
          let recognitionStatus = 'pending';
          let needsReview = false;
          
          if (confidence >= conservativeThreshold) {
            recognitionStatus = 'confirmed';
          } else if (confidence >= faceMatchThreshold) {
            recognitionStatus = 'review';
            needsReview = true;
          }
          
          // Find and update the first unassigned face in this photo
          // Note: In a more sophisticated system, we'd match based on bounding box overlap
          const unassignedFace = await tx.query.photoFaces.findFirst({
            where: and(
              eq(photoFaces.photoId, photoId),
              eq(photoFaces.personId, null as any) // Find faces not yet assigned to a person
            ),
          });

          if (unassignedFace) {
            // Update photo_faces with recognition result using secure parameterized query
            await tx.update(photoFaces)
              .set({ 
                personId: personId, 
                confidence: confidence,
                detectionMethod: 'group_photo', // All photos are group photos
                reviewStatus: recognitionStatus
              })
              .where(eq(photoFaces.id, unassignedFace.id));
          }

          const result = {
            personId: personId,
            confidence: confidence,
            faceId: faceId,
            status: recognitionStatus,
            needsReview: needsReview,
          };

          if (needsReview) {
            manualReviewQueue.push(result);
          } else {
            recognitionResults.push(result);
          }
        }
      }

      // If no matches found, log for future reference
      if (faceMatches.length === 0) {
        console.log(`No matches found for faces in photo ${photoId}, faces can be indexed manually later`);
      }

      // Return success result (transaction commits automatically)
      return {
        success: true,
        photoId: photoId,
        facesRecognized: recognitionResults.length,
        facesNeedingReview: manualReviewQueue.length,
        totalMatches: faceMatches.length,
        photoType: 'group_photo',
        thresholdUsed: faceMatchThreshold,
        results: recognitionResults,
        reviewQueue: manualReviewQueue,
        message: `Successfully processed face recognition for photo ${photoId}`,
      };
    } catch (error) {
      console.error("Photo recognition processing error:", error);
      throw error;
    }
  }); // End transaction
}

/**
 * Recognize faces in a photo using AWS Rekognition
 */
export async function recognizeFacesInPhoto(photoId: number, s3Key: string): Promise<FaceRecognitionResult> {
  try {
    console.log(`Starting face recognition for photo ${photoId} with key ${s3Key}`);

    // Check if AWS Rekognition is configured
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials not configured for face recognition");
    }

    if (!env.REKOGNITION_COLLECTION_ID) {
      throw new Error("REKOGNITION_COLLECTION_ID not configured");
    }

    // Use robust processing with retries
    const result = await robustFaceRecognition(photoId, s3Key, env.REKOGNITION_COLLECTION_ID);
    return result;

  } catch (error) {
    console.error("Face recognition error:", error);
    return {
      success: false,
      photoId: photoId,
      facesRecognized: 0,
      facesNeedingReview: 0,
      totalMatches: 0,
      photoType: 'group_photo',
      thresholdUsed: 60,
      results: [],
      reviewQueue: [],
      message: "Face recognition failed",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Index a new face in the Rekognition collection
 * Call this when a user assigns a name to an unknown face
 */
export async function indexNewFace(personId: number, s3Key: string, externalImageId?: string): Promise<IndexFaceResult> {
  try {
    console.log(`Indexing new face for person ${personId} with key ${s3Key}`);

    // Check if AWS Rekognition is configured
    if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
      throw new Error("AWS credentials not configured for face indexing");
    }

    if (!env.REKOGNITION_COLLECTION_ID) {
      throw new Error("REKOGNITION_COLLECTION_ID not configured");
    }

    // Get image buffer from S3 or local file system
    const imageBytes = await getImageBuffer(s3Key);

    // Index the face in Rekognition collection
    const indexCommand = new IndexFacesCommand({
      CollectionId: env.REKOGNITION_COLLECTION_ID,
      Image: {
        Bytes: imageBytes,
      },
      ExternalImageId: externalImageId || `person-${personId}-${Date.now()}`,
      MaxFaces: 1,
      QualityFilter: "AUTO",
    });

    const indexResponse = await rekognitionClient.send(indexCommand);
    const indexedFaces = indexResponse.FaceRecords || [];

    if (indexedFaces.length > 0) {
      const faceRecord = indexedFaces[0];
      const awsFaceId = faceRecord?.Face?.FaceId;

      if (!awsFaceId) {
        throw new Error("No face ID returned from indexing");
      }

      // Store face encoding in database using secure Drizzle ORM with transaction
      await db.transaction(async (tx) => {
        await tx.insert(faceEncodings).values({
          personId: personId,
          awsFaceId: awsFaceId,
          confidence: faceRecord.Face?.Confidence || 0,
          imageUrl: s3Key,
        });
      });

      return {
        success: true,
        awsFaceId: awsFaceId,
        personId: personId,
        confidence: faceRecord.Face?.Confidence || 0,
      };
    } else {
      throw new Error("No faces could be indexed from the image");
    }

  } catch (error) {
    console.error("Face indexing error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Check if face recognition is properly configured
 */
export function isFaceRecognitionConfigured(): boolean {
  return !!(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.AWS_REGION && env.REKOGNITION_COLLECTION_ID);
}