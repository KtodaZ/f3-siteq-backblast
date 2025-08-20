import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { photoFaces, photos } from "~/server/db/schema";
import { uploadToS3, isS3Configured, deleteFromS3, getPresignedUrl } from "~/server/services/s3";
import { detectFacesInPhoto, isFaceDetectionConfigured } from "~/server/services/localFaceDetection";
import { recognizeFacesInPhoto, isFaceRecognitionConfigured } from "~/server/services/localFaceRecognition";

export const photoRouter = createTRPCRouter({
	upload: publicProcedure
		.input(
			z.object({
				filename: z.string().min(1),
				fileData: z.string(), // base64 encoded file data
				fileSize: z.number().max(10 * 1024 * 1024), // 10MB max
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				// Validate file type from base64 header
				const fileType = input.fileData.split(";")[0]?.split(":")[1];
				if (
					!fileType ||
					!["image/jpeg", "image/png", "image/webp"].includes(fileType)
				) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message:
							"Invalid file type. Only JPEG, PNG, and WebP are supported.",
					});
				}

				// Generate unique filename
				const timestamp = Date.now();
				const randomString = Math.random().toString(36).substring(7);
				const fileExtension = input.filename.split(".").pop() || "jpg";
				const uniqueFilename = `${timestamp}-${randomString}.${fileExtension}`;

				// Extract base64 data
				const base64Data = input.fileData.split(",")[1];
				if (!base64Data) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Invalid file data format",
					});
				}

				let s3Key: string;

				// Upload to S3 (required)
				if (!isS3Configured()) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "S3 storage is required but not configured",
					});
				}

				const buffer = Buffer.from(base64Data, "base64");
				const uploadResult = await uploadToS3(
					buffer,
					input.filename,
					fileType!,
					undefined // TODO: Add user ID from session
				);
				s3Key = uploadResult.key;
				
				// Store the photo record
				const [photo] = await ctx.db
					.insert(photos)
					.values({
						filename: input.filename,
						s3Key,
						processingStatus: "processing",
						faceCount: 0,
					})
					.returning();

				if (!photo) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create photo record",
					});
				}

				// Real face detection and recognition processing
				setTimeout(async () => {
					try {
						console.log(`Starting face processing for photo ${photo.id} with key ${s3Key}`);
						
						// Check if face detection is configured
						if (!isFaceDetectionConfigured()) {
							console.warn("Face detection not configured, skipping processing");
							await ctx.db
								.update(photos)
								.set({ 
									processingStatus: "failed",
									lastError: "AWS credentials not configured for face detection"
								})
								.where(eq(photos.id, photo.id));
							return;
						}

						// Step 1: Detect faces in the photo
						console.log(`Detecting faces in photo ${photo.id}`);
						const detectionResult = await detectFacesInPhoto(photo.id, s3Key);
						
						if (!detectionResult.success) {
							console.error(`Face detection failed for photo ${photo.id}:`, detectionResult.error);
							return; // detectFacesInPhoto already updated the database with error status
						}

						console.log(`Successfully detected ${detectionResult.facesDetected} faces in photo ${photo.id}`);

						// Step 2: If faces were detected and face recognition is configured, try to recognize them
						if (detectionResult.facesDetected > 0 && isFaceRecognitionConfigured()) {
							console.log(`Recognizing faces in photo ${photo.id}`);
							const recognitionResult = await recognizeFacesInPhoto(photo.id, s3Key);
							
							if (recognitionResult.success) {
								console.log(`Successfully recognized ${recognitionResult.facesRecognized} faces, ${recognitionResult.facesNeedingReview} need review`);
							} else {
								console.warn(`Face recognition failed for photo ${photo.id}:`, recognitionResult.error);
								// Detection was successful, so we still have face data even if recognition failed
							}
						} else if (detectionResult.facesDetected > 0) {
							console.log(`Face recognition not configured, skipping recognition step for photo ${photo.id}`);
						}

						console.log(`Completed face processing for photo ${photo.id}`);
						
					} catch (error) {
						console.error("Face processing error:", error);
						// Mark as failed if error occurs
						await ctx.db
							.update(photos)
							.set({ 
								processingStatus: "failed",
								lastError: error instanceof Error ? error.message : "Unknown processing error"
							})
							.where(eq(photos.id, photo.id));
					}
				}, 100); // Start processing after response

				return {
					success: true,
					photoId: photo.id,
					s3Key: photo.s3Key,
					message: "Photo uploaded successfully",
				};
			} catch (error) {
				console.error("Photo upload error:", error);
				if (error instanceof TRPCError) {
					throw error;
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to upload photo",
				});
			}
		}),

	getById: publicProcedure
		.input(z.object({ id: z.number() }))
		.query(async ({ ctx, input }) => {
			const photo = await ctx.db.query.photos.findFirst({
				where: eq(photos.id, input.id),
			});

			if (!photo) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Photo not found",
				});
			}

			return photo;
		}),

	getAll: publicProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const allPhotos = await ctx.db.query.photos.findMany({
				limit: input.limit,
				offset: input.offset,
				orderBy: (photos, { desc }) => [desc(photos.uploadDate)],
			});

			return allPhotos;
		}),

	updateProcessingStatus: publicProcedure
		.input(
			z.object({
				id: z.number(),
				status: z.enum(["pending", "processing", "completed", "failed"]),
				faceCount: z.number().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const updateData: any = { processingStatus: input.status };
			if (input.faceCount !== undefined) {
				updateData.faceCount = input.faceCount;
			}

			const [updatedPhoto] = await ctx.db
				.update(photos)
				.set(updateData)
				.where(eq(photos.id, input.id))
				.returning();

			if (!updatedPhoto) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Photo not found",
				});
			}

			return updatedPhoto;
		}),

	delete: publicProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			// Get photo to find S3 key for deletion
			const photo = await ctx.db.query.photos.findFirst({
				where: eq(photos.id, input.id),
			});

			if (!photo) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Photo not found",
				});
			}

			// Delete from S3 (required)
			if (!isS3Configured()) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "S3 storage is required but not configured",
				});
			}

			try {
				await deleteFromS3(photo.s3Key);
			} catch (error) {
				console.warn("Failed to delete from S3:", error);
				// Continue with database deletion even if S3 deletion fails
			}

			// Delete from database using transaction to handle foreign key constraints
			await ctx.db.transaction(async (tx) => {
				// First delete all related photo faces
				await tx.delete(photoFaces).where(eq(photoFaces.photoId, input.id));
				
				// Then delete the photo
				await tx.delete(photos).where(eq(photos.id, input.id));
			});

			return { success: true, message: "Photo deleted successfully" };
		}),

	getFaces: publicProcedure
		.input(z.object({ photoId: z.number() }))
		.query(async ({ ctx, input }) => {
			const faces = await ctx.db.query.photoFaces.findMany({
				where: eq(photoFaces.photoId, input.photoId),
				with: {
					person: true,
				},
				orderBy: (photoFaces, { asc }) => [asc(photoFaces.id)],
			});

			return faces;
		}),

	assignFace: publicProcedure
		.input(
			z.object({
				faceId: z.number(),
				personId: z.number(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [updatedFace] = await ctx.db
				.update(photoFaces)
				.set({
					personId: input.personId,
					isConfirmed: true,
				})
				.where(eq(photoFaces.id, input.faceId))
				.returning();

			if (!updatedFace) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Face not found",
				});
			}

			return updatedFace;
		}),

	getPresignedUrl: publicProcedure
		.input(z.object({ photoId: z.number() }))
		.query(async ({ ctx, input }) => {
			console.log("getPresignedUrl: Starting for photoId", input.photoId);
			
			// Get photo to find S3 key
			const photo = await ctx.db.query.photos.findFirst({
				where: eq(photos.id, input.photoId),
			});

			if (!photo) {
				console.log("getPresignedUrl: Photo not found for ID", input.photoId);
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Photo not found",
				});
			}
			
			console.log("getPresignedUrl: Found photo", {
				id: photo.id,
				s3Key: photo.s3Key,
				filename: photo.filename,
				startsWithUploads: photo.s3Key.startsWith("/uploads/")
			});

			// Generate S3 presigned URL (required)
			if (!isS3Configured()) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "S3 storage is required but not configured",
				});
			}

			console.log("getPresignedUrl: S3 configured, generating presigned URL for", photo.s3Key);
			try {
				const presignedUrl = await getPresignedUrl(photo.s3Key, 3600); // 1 hour expiration
				console.log("getPresignedUrl: Successfully generated S3 presigned URL");
				return {
					url: presignedUrl,
					expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
				};
			} catch (error) {
				console.error("getPresignedUrl: Failed to generate presigned URL:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to generate presigned URL",
				});
			}
		}),
});
