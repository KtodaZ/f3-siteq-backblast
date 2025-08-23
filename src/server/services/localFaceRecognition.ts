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

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	DeleteFacesCommand,
	IndexFacesCommand,
	ListFacesCommand,
	RekognitionClient,
	SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "~/env";
import { db } from "~/server/db";
import { faceEncodings, photoFaces } from "~/server/db/schema";

// Initialize AWS clients
const rekognitionClient = new RekognitionClient({
	region: env.AWS_REGION ?? "us-east-1",
	credentials:
		env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
			? {
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				}
			: undefined,
});

const s3Client = new S3Client({
	region: env.AWS_REGION ?? "us-east-1",
	credentials:
		env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
			? {
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				}
			: undefined,
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

export interface DeleteFaceResult {
	success: boolean;
	deletedFaceIds?: string[];
	error?: string;
}

export interface ListFacesResult {
	success: boolean;
	faces?: Array<{
		faceId: string;
		boundingBox?: any;
		confidence?: number;
		imageId?: string;
	}>;
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
async function robustFaceRecognition(
	photoId: number,
	s3Key: string,
	collectionId: string,
	maxRetries = 3,
): Promise<FaceRecognitionResult> {
	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		try {
			console.log(`Face recognition attempt ${attempt} for photo ${photoId}`);

			const result = await processPhotoRecognition(
				photoId,
				s3Key,
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

	throw new Error("Failed to process face recognition after all retries");
}

/**
 * Core photo recognition processing logic
 */
async function processPhotoRecognition(
	photoId: number,
	s3Key: string,
	collectionId: string,
): Promise<FaceRecognitionResult> {
	// Start transaction for atomic operations
	return await db.transaction(async (tx) => {
		try {
			// Get image buffer from S3 or local file system
			const imageBytes = await getImageBuffer(s3Key);

			// All photos are group photos - use optimized thresholds
			const faceMatchThreshold = 60; // Lower threshold for group photos
			const conservativeThreshold = 75; // Conservative threshold for final results

			console.log(
				`Processing group photo with threshold ${faceMatchThreshold}%`,
			);

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

			console.log(
				`Found ${faceMatches.length} face matches for photo ${photoId}`,
			);

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
					let recognitionStatus = "pending";
					let needsReview = false;

					if (confidence >= conservativeThreshold) {
						recognitionStatus = "confirmed";
					} else if (confidence >= faceMatchThreshold) {
						recognitionStatus = "review";
						needsReview = true;
					}

					// Find the best matching face based on bounding box overlap
					const allUnassignedFaces = await tx.query.photoFaces.findMany({
						where: and(
							eq(photoFaces.photoId, photoId),
							isNull(photoFaces.personId), // Find faces not yet assigned to a person
						),
					});

					// Debug: Also get all faces for this photo to understand what's happening
					const allFaces = await tx.query.photoFaces.findMany({
						where: eq(photoFaces.photoId, photoId),
					});

					console.log(
						`🔍 Looking for face match among ${allUnassignedFaces.length} unassigned faces out of ${allFaces.length} total faces`,
					);
					console.log(
						"📊 Face assignment status:",
						allFaces.map((f) => ({
							id: f.id,
							personId: f.personId,
							awsFaceId: f.awsFaceId,
							isAssigned: !!f.personId,
						})),
					);
					console.log("🎯 Target face bounding box:", match.Face?.BoundingBox);

					// Find face with best bounding box overlap
					let bestMatch = null;
					let bestOverlap = 0;

					for (const face of allUnassignedFaces) {
						if (!face.boundingBox || !match.Face?.BoundingBox) continue;

						const faceBB = face.boundingBox as any;
						const matchBB = match.Face.BoundingBox;

						// Ensure all bounding box values exist
						if (
							typeof faceBB.left !== "number" ||
							typeof faceBB.top !== "number" ||
							typeof faceBB.width !== "number" ||
							typeof faceBB.height !== "number" ||
							typeof matchBB.Left !== "number" ||
							typeof matchBB.Top !== "number" ||
							typeof matchBB.Width !== "number" ||
							typeof matchBB.Height !== "number"
						)
							continue;

						// Calculate overlap area
						const overlapLeft = Math.max(faceBB.left, matchBB.Left);
						const overlapTop = Math.max(faceBB.top, matchBB.Top);
						const overlapRight = Math.min(
							faceBB.left + faceBB.width,
							matchBB.Left + matchBB.Width,
						);
						const overlapBottom = Math.min(
							faceBB.top + faceBB.height,
							matchBB.Top + matchBB.Height,
						);

						if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
							const overlapArea =
								(overlapRight - overlapLeft) * (overlapBottom - overlapTop);
							const faceArea = faceBB.width * faceBB.height;
							const overlapRatio = faceArea > 0 ? overlapArea / faceArea : 0;

							console.log(
								`📐 Face ${face.id} overlap ratio: ${overlapRatio.toFixed(3)}`,
							);

							if (overlapRatio > bestOverlap) {
								bestOverlap = overlapRatio;
								bestMatch = face;
							}
						}
					}

					// Only assign if we have a good overlap match (require minimum 50% overlap)
					const targetFace = bestOverlap > 0.5 ? bestMatch : null;

					if (targetFace) {
						// Update photo_faces with recognition result using secure parameterized query
						await tx
							.update(photoFaces)
							.set({
								personId: personId,
								confidence: confidence,
								detectionMethod: "group_photo", // All photos are group photos
								reviewStatus: recognitionStatus,
							})
							.where(eq(photoFaces.id, targetFace.id));
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
				console.log(
					`No matches found for faces in photo ${photoId}, faces can be indexed manually later`,
				);
			}

			// Return success result (transaction commits automatically)
			console.log(
				`🎊 Face recognition transaction completing for photo ${photoId}. Assigned ${recognitionResults.length} faces.`,
			);

			const result = {
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
			};

			console.log(
				`✅ Transaction successful for photo ${photoId}, returning result`,
			);
			return result;
		} catch (error) {
			console.error("Photo recognition processing error:", error);
			throw error;
		}
	}); // End transaction
}

/**
 * Recognize faces in a photo using AWS Rekognition
 */
export async function recognizeFacesInPhoto(
	photoId: number,
	s3Key: string,
): Promise<FaceRecognitionResult> {
	try {
		console.log(
			`Starting face recognition for photo ${photoId} with key ${s3Key}`,
		);

		// Check if AWS Rekognition is configured
		if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
			throw new Error("AWS credentials not configured for face recognition");
		}

		if (!env.REKOGNITION_COLLECTION_ID) {
			throw new Error("REKOGNITION_COLLECTION_ID not configured");
		}

		// Use robust processing with retries
		const result = await robustFaceRecognition(
			photoId,
			s3Key,
			env.REKOGNITION_COLLECTION_ID,
		);
		return result;
	} catch (error) {
		console.error("Face recognition error:", error);
		return {
			success: false,
			photoId: photoId,
			facesRecognized: 0,
			facesNeedingReview: 0,
			totalMatches: 0,
			photoType: "group_photo",
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
export async function indexNewFace(
	personId: number,
	s3Key: string,
	externalImageId?: string,
	tx?: any, // Optional transaction parameter
): Promise<IndexFaceResult> {
	try {
		console.log(
			`🚀 Starting face indexing for person ${personId} with S3 key: ${s3Key}`,
		);

		// Validate inputs
		if (!personId || personId <= 0) {
			throw new Error(`Invalid person ID: ${personId}`);
		}

		if (!s3Key || s3Key.trim().length === 0) {
			throw new Error("S3 key is required for face indexing");
		}

		// Check if AWS Rekognition is configured
		if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
			throw new Error("AWS credentials not configured for face indexing");
		}

		if (!env.REKOGNITION_COLLECTION_ID) {
			throw new Error("REKOGNITION_COLLECTION_ID not configured");
		}

		if (!env.S3_BUCKET_NAME) {
			throw new Error("S3_BUCKET_NAME not configured");
		}

		// Get image buffer from S3 or local file system
		console.log(`📁 Getting image buffer from S3 key: ${s3Key}`);
		const imageBytes = await getImageBuffer(s3Key);
		console.log(`📁 Retrieved ${imageBytes.length} bytes from S3`);

		// Index the face in Rekognition collection
		const externalId = externalImageId || `person-${personId}-${Date.now()}`;
		console.log(`🔍 About to index face in AWS Rekognition collection: ${env.REKOGNITION_COLLECTION_ID}, externalId: ${externalId}`);
		
		const indexCommand = new IndexFacesCommand({
			CollectionId: env.REKOGNITION_COLLECTION_ID,
			Image: {
				Bytes: imageBytes,
			},
			ExternalImageId: externalId,
			MaxFaces: 1,
			QualityFilter: "AUTO",
		});

		let indexResponse;
		try {
			indexResponse = await rekognitionClient.send(indexCommand);
			console.log(`✅ AWS Rekognition IndexFaces command succeeded`);
		} catch (awsError) {
			console.error(`❌ AWS Rekognition IndexFaces command failed:`, awsError);
			throw awsError;
		}
		
		const indexedFaces = indexResponse.FaceRecords || [];
		console.log(`🔍 AWS returned ${indexedFaces.length} indexed faces`);

		if (indexedFaces.length > 0) {
			const faceRecord = indexedFaces[0];
			const awsFaceId = faceRecord?.Face?.FaceId;

			if (!awsFaceId) {
				throw new Error("No face ID returned from indexing");
			}

			const confidence = faceRecord.Face?.Confidence || 0;
			console.log(
				`🔗 Storing face encoding in database: AWS Face ID ${awsFaceId}, Person ID ${personId}, Confidence ${confidence.toFixed(1)}%`,
			);

			// Store face encoding in database using secure Drizzle ORM with transaction
			const insertFaceEncoding = async (dbTx: any) => {
				console.log(`📝 About to insert face encoding: personId=${personId}, awsFaceId=${awsFaceId}, confidence=${confidence}`);
				
				try {
					// Insert into faceEncodings table for future recognition
					const [faceEncoding] = await dbTx
						.insert(faceEncodings)
						.values({
							personId: personId,
							awsFaceId: awsFaceId,
							confidence: confidence,
							imageUrl: s3Key,
						})
						.returning();

					if (!faceEncoding) {
						console.error("❌ Failed to create face encoding record - no record returned");
						throw new Error("Failed to create face encoding record in database");
					}

					console.log(
						`✅ Created face encoding record ${faceEncoding.id} for AWS Face ID ${awsFaceId}`,
					);
					return faceEncoding;
				} catch (error) {
					console.error(`❌ Error inserting face encoding: ${error}`);
					throw error;
				}
			};

			// Use provided transaction or create a new one - but with better error handling
			let faceEncodingResult;
			if (tx) {
				console.log(`🔗 Using existing transaction to insert face encoding`);
				faceEncodingResult = await insertFaceEncoding(tx);
			} else {
				console.log(`🆕 Creating new transaction to insert face encoding`);
				faceEncodingResult = await db.transaction(insertFaceEncoding);
			}

			console.log(
				`✅ Face indexing completed successfully for person ${personId}`,
			);

			return {
				success: true,
				awsFaceId: awsFaceId,
				personId: personId,
				confidence: confidence,
			};
		}
		const errorMsg =
			"No faces could be indexed from the image - image may not contain a clear face or face quality is too low";
		console.error(`❌ ${errorMsg}`);
		throw new Error(errorMsg);
	} catch (error) {
		console.error(
			`❌ Face indexing error for person ${personId}, S3 key ${s3Key}:`,
			error,
		);

		// Provide more specific error messages based on error type
		let errorMessage = "Unknown error occurred during face indexing";
		if (error instanceof Error) {
			errorMessage = error.message;

			// Enhance common AWS errors with more context
			if (errorMessage.includes("InvalidImageFormatException")) {
				errorMessage =
					"Image format not supported for face indexing. Please ensure the image is a valid JPEG, PNG, or WebP file.";
			} else if (errorMessage.includes("ImageTooLargeException")) {
				errorMessage =
					"Image is too large for face indexing. Please resize the image and try again.";
			} else if (errorMessage.includes("InvalidParameterException")) {
				errorMessage =
					"Invalid parameters provided to face indexing service. Please check the image quality.";
			} else if (errorMessage.includes("NoSuchCollection")) {
				errorMessage = `AWS Rekognition collection '${env.REKOGNITION_COLLECTION_ID}' does not exist. Please create the collection first.`;
			} else if (errorMessage.includes("AccessDenied")) {
				errorMessage =
					"Access denied to AWS Rekognition service. Please check AWS credentials and permissions.";
			} else if (errorMessage.includes("No faces could be indexed")) {
				errorMessage =
					"No clear face detected in the image region. The face may be too small, blurry, or at an angle that prevents indexing.";
			}
		}

		return {
			success: false,
			error: errorMessage,
			personId: personId,
		};
	}
}

/**
 * Delete faces from the Rekognition collection
 */
export async function deleteFacesFromCollection(
	faceIds: string[],
): Promise<DeleteFaceResult> {
	try {
		// Check if AWS Rekognition is configured
		if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
			throw new Error("AWS credentials not configured for face deletion");
		}

		if (!env.REKOGNITION_COLLECTION_ID) {
			throw new Error("REKOGNITION_COLLECTION_ID not configured");
		}

		if (faceIds.length === 0) {
			return {
				success: true,
				deletedFaceIds: [],
			};
		}

		// Delete faces from Rekognition collection
		const deleteCommand = new DeleteFacesCommand({
			CollectionId: env.REKOGNITION_COLLECTION_ID,
			FaceIds: faceIds,
		});

		const deleteResponse = await rekognitionClient.send(deleteCommand);

		return {
			success: true,
			deletedFaceIds: deleteResponse.DeletedFaces || [],
		};
	} catch (error) {
		console.error("Face deletion error:", error);
		return {
			success: false,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

/**
 * List all faces in the Rekognition collection
 */
export async function listFacesInCollection(): Promise<ListFacesResult> {
	try {
		// Check if AWS Rekognition is configured
		if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
			throw new Error("AWS credentials not configured for face listing");
		}

		if (!env.REKOGNITION_COLLECTION_ID) {
			throw new Error("REKOGNITION_COLLECTION_ID not configured");
		}

		// List faces in Rekognition collection
		const listCommand = new ListFacesCommand({
			CollectionId: env.REKOGNITION_COLLECTION_ID,
			MaxResults: 4096, // Maximum allowed
		});

		const listResponse = await rekognitionClient.send(listCommand);
		const faces = listResponse.Faces || [];

		return {
			success: true,
			faces: faces.map((face) => ({
				faceId: face.FaceId || "",
				boundingBox: face.BoundingBox,
				confidence: face.Confidence,
				imageId: face.ImageId,
			})),
		};
	} catch (error) {
		console.error("Face listing error:", error);
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
	return !!(
		env.AWS_ACCESS_KEY_ID &&
		env.AWS_SECRET_ACCESS_KEY &&
		env.AWS_REGION &&
		env.REKOGNITION_COLLECTION_ID
	);
}
