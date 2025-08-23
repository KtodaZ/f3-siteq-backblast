/**
 * AWS Lambda function for face recognition using AWS Rekognition
 *
 * ⚠️  IMPORTANT: This file's core logic is duplicated in src/server/services/localFaceRecognition.ts
 *
 * This function takes detected faces and tries to match them against
 * known faces in the Rekognition collection.
 *
 * When making changes to recognition algorithms, confidence thresholds, or database updates,
 * ensure BOTH files are kept in sync:
 *
 * - lambda/recognizeFaces.js (this file) - for AWS Lambda deployment
 * - src/server/services/localFaceRecognition.ts - for local development
 *
 * The main differences:
 * - This file includes AWS Lambda handler wrapper for cloud deployment
 * - Local version integrates directly with Next.js app
 * - Both use identical face recognition and matching logic
 */

import {
	IndexFacesCommand,
	RekognitionClient,
	SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// Import schema definitions (needs to be copied from main project)
import { createTable } from "drizzle-orm/pg-core";
import {
	boolean,
	integer,
	jsonb,
	pgTableCreator,
	real,
	serial,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

// Schema definitions (copied from main project)
const createTableWithPrefix = pgTableCreator(
	(name) => `f3-siteq-backblast_${name}`,
);

const people = createTableWithPrefix("people", {
	id: serial("id").primaryKey(),
	name: varchar("name", { length: 255 }).notNull(),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

const faceEncodings = createTableWithPrefix("face_encodings", {
	id: serial("id").primaryKey(),
	personId: integer("person_id").references(() => people.id),
	awsFaceId: varchar("aws_face_id", { length: 255 }).unique().notNull(),
	confidence: real("confidence"),
	imageUrl: varchar("image_url", { length: 500 }),
	createdAt: timestamp("created_at").defaultNow(),
});

const photoFaces = createTableWithPrefix("photo_faces", {
	id: serial("id").primaryKey(),
	photoId: integer("photo_id"),
	personId: integer("person_id").references(() => people.id),
	awsFaceId: varchar("aws_face_id", { length: 255 }),
	confidence: real("confidence"),
	boundingBox: jsonb("bounding_box"),
	isConfirmed: boolean("is_confirmed").default(false),
	detectionMethod: varchar("detection_method", { length: 50 }),
	reviewStatus: varchar("review_status", { length: 20 }).default("pending"),
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
 * Robust face recognition with retry logic
 */
async function robustFaceRecognition(
	photoId,
	s3Key,
	bucketName,
	collectionId,
	maxRetries = 3,
) {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(`Face recognition attempt ${attempt} for photo ${photoId}`);

			const result = await processPhotoRecognition(
				photoId,
				s3Key,
				bucketName,
				collectionId,
			);
			if (result.success) {
				return result;
			}

			if (attempt < maxRetries) {
				const backoffMs = 2 ** attempt * 1000; // Exponential backoff
				console.log(`Retrying in ${backoffMs}ms...`);
				await new Promise((resolve) => setTimeout(resolve, backoffMs));
			}
		} catch (error) {
			console.error(`Attempt ${attempt} failed:`, error);

			if (attempt === maxRetries) {
				throw error;
			}
		}
	}
}

/**
 * Main Lambda handler with error handling
 */
export const handler = async (event) => {
	try {
		console.log("Face recognition started for event:", JSON.stringify(event));

		const { photoId, s3Key, bucketName, collectionId } = event;

		if (!photoId || !s3Key || !bucketName || !collectionId) {
			throw new Error(
				"Missing required parameters: photoId, s3Key, bucketName, collectionId",
			);
		}

		// Use robust processing with retries
		const result = await robustFaceRecognition(
			photoId,
			s3Key,
			bucketName,
			collectionId,
		);
		return result;
	} catch (error) {
		console.error("Face recognition handler error:", error);
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
 * Core photo recognition processing logic
 */
async function processPhotoRecognition(
	photoId,
	s3Key,
	bucketName,
	collectionId,
) {
	// Start transaction for atomic operations
	return await db.transaction(async (tx) => {
		// Get image from S3
		const getObjectCommand = new GetObjectCommand({
			Bucket: bucketName,
			Key: s3Key,
		});

		const s3Response = await s3Client.send(getObjectCommand);
		const imageBytes = await s3Response.Body.transformToByteArray();

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
		const searchedFace = searchResponse.SearchedFace;

		console.log(
			`Found ${faceMatches.length} face matches for photo ${photoId}`,
		);

		// Process face matches and update database with confidence-based handling
		const recognitionResults = [];
		const manualReviewQueue = [];

		for (const match of faceMatches) {
			const faceId = match.Face.FaceId;
			const confidence = match.Similarity;

			// Look up person ID from face_encodings table using secure Drizzle ORM
			const personRecord = await tx.query.faceEncodings.findFirst({
				where: eq(faceEncodings.awsFaceId, faceId),
				columns: { personId: true },
			});

			if (personRecord?.personId) {
				const personId = personRecord.personId;

				// Determine recognition status based on confidence level
				let recognitionStatus = "pending";
				let needsReview = false;

				if (confidence >= conservativeThreshold) {
					recognitionStatus = "confirmed";
				} else if (confidence >= faceMatchThreshold) {
					recognitionStatus = "review";
					needsReview = true;
				}

				// Update photo_faces with recognition result using secure parameterized query
				await tx
					.update(photoFaces)
					.set({
						personId: personId,
						confidence: confidence,
						detectionMethod: "group_photo", // All photos are group photos
						reviewStatus: recognitionStatus,
					})
					.where(
						and(
							eq(photoFaces.photoId, Number.parseInt(photoId)),
							eq(photoFaces.awsFaceId, searchedFace.FaceId),
						),
					);

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

		// If no matches found and this is a new face, optionally index it for future recognition
		if (faceMatches.length === 0 && searchedFace) {
			console.log(
				`No matches found for face in photo ${photoId}, face can be indexed manually later`,
			);
		}

		// Return success result (transaction commits automatically)
		return {
			statusCode: 200,
			body: JSON.stringify({
				success: true,
				photoId: photoId,
				facesRecognized: recognitionResults.length,
				facesNeedingReview: manualReviewQueue.length,
				totalMatches: faceMatches.length,
				photoType: "group_photo",
				thresholdUsed: faceMatchThreshold,
				results: recognitionResults,
				reviewQueue: manualReviewQueue,
				message: `Successfully processed face recognition for photo ${photoId}`,
			}),
		};
	}); // End transaction
}

/**
 * Helper function to index a new face in the Rekognition collection
 * Call this when a user assigns a name to an unknown face
 */
export const indexNewFace = async (event) => {
	try {
		const { personId, s3Key, bucketName, collectionId, externalImageId } =
			event;

		// Get image from S3
		const getObjectCommand = new GetObjectCommand({
			Bucket: bucketName,
			Key: s3Key,
		});

		const s3Response = await s3Client.send(getObjectCommand);
		const imageBytes = await s3Response.Body.transformToByteArray();

		// Index the face in Rekognition collection
		const indexCommand = new IndexFacesCommand({
			CollectionId: collectionId,
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
			const awsFaceId = faceRecord.Face.FaceId;

			// Store face encoding in database using secure Drizzle ORM with transaction
			await db.transaction(async (tx) => {
				await tx.insert(faceEncodings).values({
					personId: Number.parseInt(personId),
					awsFaceId: awsFaceId,
					confidence: faceRecord.Face.Confidence,
					imageUrl: s3Key,
				});
			});

			return {
				statusCode: 200,
				body: JSON.stringify({
					success: true,
					awsFaceId: awsFaceId,
					personId: personId,
					confidence: faceRecord.Face.Confidence,
				}),
			};
		}
		throw new Error("No faces could be indexed from the image");
	} catch (error) {
		console.error("Face indexing error:", error);
		return {
			statusCode: 500,
			body: JSON.stringify({
				success: false,
				error: error.message,
			}),
		};
	} finally {
		await client.end();
	}
};
