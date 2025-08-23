import { TRPCError } from "@trpc/server";
import { count, eq, inArray, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { faceEncodings, people, photoFaces, photos } from "~/server/db/schema";
import {
	detectFacesInPhoto,
	isFaceDetectionConfigured,
} from "~/server/services/localFaceDetection";
import {
	deleteFacesFromCollection,
	indexNewFace,
	isFaceRecognitionConfigured,
	recognizeFacesInPhoto,
} from "~/server/services/localFaceRecognition";
import {
	deleteFromS3,
	getPresignedUrl,
	isS3Configured,
	uploadToS3,
} from "~/server/services/s3";

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
					undefined, // TODO: Add user ID from session
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

				// Immediate face processing for Vercel deployment
				// For large photos or slow processing, this will be handled by queue system
				try {
					console.log(
						`🚀 Starting immediate face processing for photo ${photo.id} with key ${s3Key}`,
					);

					// Check if face detection is configured
					if (!isFaceDetectionConfigured()) {
						console.warn(
							"Face detection not configured, queuing for background processing",
						);
						// Mark as failed if face detection not configured
						await ctx.db
							.update(photos)
							.set({
								processingStatus: "failed",
								lastError: "Face detection not configured - please configure AWS credentials",
							})
							.where(eq(photos.id, photo.id));
					} else {
						// Step 1: Detect faces in the photo
						console.log(`Detecting faces in photo ${photo.id}`);
						const detectionResult = await detectFacesInPhoto(photo.id, s3Key);

						if (!detectionResult.success) {
							console.error(
								`Face detection failed for photo ${photo.id}:`,
								detectionResult.error,
							);
							// Mark as failed if detection failed
							await ctx.db
								.update(photos)
								.set({
									processingStatus: "failed",
									lastError: detectionResult.error,
								})
								.where(eq(photos.id, photo.id));
						} else {
							console.log(
								`Successfully detected ${detectionResult.facesDetected} faces in photo ${photo.id}`,
							);

							// Step 2: If faces were detected and face recognition is configured, try to recognize them
							if (
								detectionResult.facesDetected > 0 &&
								isFaceRecognitionConfigured()
							) {
								console.log(`Recognizing faces in photo ${photo.id}`);
								const recognitionResult = await recognizeFacesInPhoto(
									photo.id,
									s3Key,
								);

								if (recognitionResult.success) {
									console.log(
										`Successfully recognized ${recognitionResult.facesRecognized} faces, ${recognitionResult.facesNeedingReview} need review`,
									);
								} else {
									console.warn(
										`Face recognition failed for photo ${photo.id}:`,
										recognitionResult.error,
									);
									// Detection was successful, so we still have face data even if recognition failed
								}
							} else if (detectionResult.facesDetected > 0) {
								console.log(
									`Face recognition not configured, skipping recognition step for photo ${photo.id}`,
								);
							}

							console.log(
								`✅ Completed immediate processing for photo ${photo.id}`,
							);
						}
					}
				} catch (error) {
					console.error(
						`❌ Immediate face processing error for photo ${photo.id}:`,
						error,
					);
					// Mark as failed after processing error
					await ctx.db
						.update(photos)
						.set({
							processingStatus: "failed",
							lastError:
								error instanceof Error
									? `Processing failed: ${error.message}`
									: "Unknown processing error",
						})
						.where(eq(photos.id, photo.id));
				}

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
			// Get all photos with basic data
			const allPhotos = await ctx.db.query.photos.findMany({
				limit: input.limit,
				offset: input.offset,
				orderBy: (photos, { desc }) => [desc(photos.uploadDate)],
			});

			// For each photo, get the count of tagged faces (faces with personId)
			const photosWithTaggedCount = await Promise.all(
				allPhotos.map(async (photo) => {
					const [taggedFacesResult] = await ctx.db
						.select({ count: count() })
						.from(photoFaces)
						.where(
							eq(photoFaces.photoId, photo.id) && isNotNull(photoFaces.personId)
						);

					return {
						...photo,
						taggedFaceCount: taggedFacesResult?.count || 0,
					};
				})
			);

			return photosWithTaggedCount;
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
			try {
				console.log(
					`🗑️ Starting comprehensive photo deletion for photo ${input.id}`,
				);

				// Use atomic transaction to ensure complete cleanup
				const result = await ctx.db.transaction(async (tx) => {
					// Step 1: Get photo and all related face data before deletion
					const photoWithFaces = await tx.query.photos.findFirst({
						where: eq(photos.id, input.id),
						with: {
							photoFaces: true,
						},
					});

					if (!photoWithFaces) {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Photo not found",
						});
					}

					console.log(
						`📷 Found photo "${photoWithFaces.filename}" with ${photoWithFaces.photoFaces.length} faces`,
					);

					// Step 2: Collect AWS Face IDs that need to be cleaned up
					const awsFaceIds = photoWithFaces.photoFaces
						.map((face) => face.awsFaceId)
						.filter(
							(faceId): faceId is string =>
								faceId !== null && faceId !== undefined,
						);

					console.log(
						`🔍 Found ${awsFaceIds.length} AWS face IDs to clean up: ${awsFaceIds.join(", ")}`,
					);

					// Step 3: Remove faces from AWS Rekognition collection
					if (isFaceRecognitionConfigured() && awsFaceIds.length > 0) {
						console.log(
							`☁️ Removing ${awsFaceIds.length} faces from AWS Rekognition collection`,
						);

						const deleteResult = await deleteFacesFromCollection(awsFaceIds);
						if (!deleteResult.success) {
							console.error(
								`❌ Failed to delete faces from AWS collection: ${deleteResult.error}`,
							);
							// Don't throw - continue with database deletion even if AWS cleanup fails
							console.warn(
								"⚠️ Continuing with photo deletion despite AWS cleanup failure",
							);
						} else {
							console.log(
								`✅ Successfully removed ${deleteResult.deletedFaceIds?.length || 0} faces from AWS collection`,
							);
						}
					}

					// Step 4: Clean up orphaned face encodings that reference these AWS face IDs
					let deletedEncodingsCount = 0;
					if (awsFaceIds.length > 0) {
						console.log(
							"🗑️ Cleaning up face encodings that reference deleted AWS faces",
						);

						const deletedEncodings = await tx
							.delete(faceEncodings)
							.where(inArray(faceEncodings.awsFaceId, awsFaceIds))
							.returning();

						deletedEncodingsCount = deletedEncodings.length;
						console.log(
							`✅ Deleted ${deletedEncodingsCount} orphaned face encodings`,
						);
					}

					// Step 5: Delete photo faces
					console.log(
						`🔗 Deleting ${photoWithFaces.photoFaces.length} photo faces`,
					);
					const deletedPhotoFaces = await tx
						.delete(photoFaces)
						.where(eq(photoFaces.photoId, input.id))
						.returning();

					console.log(`✅ Deleted ${deletedPhotoFaces.length} photo faces`);

					// Step 6: Delete the photo record
					console.log("📷 Deleting photo record");
					const [deletedPhoto] = await tx
						.delete(photos)
						.where(eq(photos.id, input.id))
						.returning();

					if (!deletedPhoto) {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Photo not found during deletion",
						});
					}

					console.log(
						`✅ Successfully deleted photo "${deletedPhoto.filename}"`,
					);

					return {
						deletedPhoto,
						deletedPhotoFacesCount: deletedPhotoFaces.length,
						deletedEncodingsCount,
						awsFaceIdsDeleted: awsFaceIds.length,
					};
				});

				// Step 7: Delete from S3 after successful database cleanup
				if (!isS3Configured()) {
					console.warn("⚠️ S3 not configured, skipping S3 cleanup");
				} else {
					try {
						console.log(
							`☁️ Deleting photo from S3: ${result.deletedPhoto.s3Key}`,
						);
						await deleteFromS3(result.deletedPhoto.s3Key);
						console.log("✅ Successfully deleted photo from S3");
					} catch (error) {
						console.warn("⚠️ Failed to delete from S3:", error);
						// Don't throw - photo is already deleted from database
					}
				}

				console.log(
					`🎉 Comprehensive photo deletion completed successfully for "${result.deletedPhoto.filename}"`,
				);

				return {
					success: true,
					message: `Photo "${result.deletedPhoto.filename}" deleted successfully`,
					details: {
						deletedPhotoFacesCount: result.deletedPhotoFacesCount,
						deletedEncodingsCount: result.deletedEncodingsCount,
						awsFaceIdsDeleted: result.awsFaceIdsDeleted,
					},
				};
			} catch (error) {
				console.error(`❌ Photo deletion failed for photo ${input.id}:`, error);
				if (error instanceof TRPCError) {
					throw error;
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to delete photo",
				});
			}
		}),

	getFaces: publicProcedure
		.input(z.object({ photoId: z.number() }))
		.query(async ({ ctx, input }) => {
			// Use a manual left join to ensure faces with NULL personId are included
			// This is necessary because Drizzle's 'with' clause may exclude NULL foreign keys
			const faces = await ctx.db
				.select({
					id: photoFaces.id,
					photoId: photoFaces.photoId,
					personId: photoFaces.personId,
					awsFaceId: photoFaces.awsFaceId,
					confidence: photoFaces.confidence,
					boundingBox: photoFaces.boundingBox,
					isConfirmed: photoFaces.isConfirmed,
					faceQuality: photoFaces.faceQuality,
					detectionMethod: photoFaces.detectionMethod,
					reviewStatus: photoFaces.reviewStatus,
					boundingBoxQuality: photoFaces.boundingBoxQuality,
					faceSize: photoFaces.faceSize,
					// Person data (will be null for deleted persons)
					person: {
						id: people.id,
						name: people.name,
						createdAt: people.createdAt,
						updatedAt: people.updatedAt,
					},
				})
				.from(photoFaces)
				.leftJoin(people, eq(photoFaces.personId, people.id))
				.where(eq(photoFaces.photoId, input.photoId))
				.orderBy(photoFaces.id);

			// Transform the result to match the expected format
			return faces.map((face) => ({
				...face,
				person: face.person?.id ? face.person : null, // Only include person if it exists
			}));
		}),

	assignFace: publicProcedure
		.input(
			z.object({
				faceId: z.number(),
				personId: z.number(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// First, get the face and photo data to access S3 key for indexing
			const faceWithPhoto = await ctx.db.query.photoFaces.findFirst({
				where: eq(photoFaces.id, input.faceId),
				with: {
					photo: true,
				},
			});

			if (!faceWithPhoto) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Face not found",
				});
			}

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

			// Index the face for future recognition if AWS is configured
			if (isFaceRecognitionConfigured() && faceWithPhoto.photo) {
				try {
					console.log(
						`🔍 Starting face indexing for face ${input.faceId}, person ${input.personId}`,
					);
					const indexResult = await indexNewFace(
						input.personId,
						faceWithPhoto.photo.s3Key,
						`face-${input.faceId}-person-${input.personId}`,
					);

					if (indexResult.success && indexResult.awsFaceId) {
						console.log(
							`✅ Face indexing successful, AWS Face ID: ${indexResult.awsFaceId}`,
						);
						// Update the photo face record with the real AWS face ID
						const [updatedFaceWithAwsId] = await ctx.db
							.update(photoFaces)
							.set({
								awsFaceId: indexResult.awsFaceId,
							})
							.where(eq(photoFaces.id, input.faceId))
							.returning();

						if (!updatedFaceWithAwsId) {
							console.error(
								`❌ Failed to update photoFace ${input.faceId} with AWS Face ID ${indexResult.awsFaceId}`,
							);
						} else {
							console.log(
								`✅ Successfully linked photoFace ${input.faceId} to AWS Face ID ${indexResult.awsFaceId}`,
							);
						}
					} else {
						console.warn(`⚠️ Face indexing failed for face ${input.faceId}:`, {
							success: indexResult.success,
							awsFaceId: indexResult.awsFaceId,
							error: indexResult.error,
						});
					}
				} catch (error) {
					console.error(
						`❌ Face indexing error for face ${input.faceId}:`,
						error,
					);
					// Don't throw - assignment should succeed even if indexing fails
				}
			} else {
				if (!isFaceRecognitionConfigured()) {
					console.log(
						`⚠️ Face recognition not configured, skipping indexing for face ${input.faceId}`,
					);
				}
				if (!faceWithPhoto.photo) {
					console.log(
						`⚠️ No photo data found for face ${input.faceId}, skipping indexing`,
					);
				}
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
				startsWithUploads: photo.s3Key.startsWith("/uploads/"),
			});

			// Generate S3 presigned URL (required)
			if (!isS3Configured()) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "S3 storage is required but not configured",
				});
			}

			console.log(
				"getPresignedUrl: S3 configured, generating presigned URL for",
				photo.s3Key,
			);
			try {
				const presignedUrl = await getPresignedUrl(photo.s3Key, 3600); // 1 hour expiration
				console.log("getPresignedUrl: Successfully generated S3 presigned URL");
				return {
					url: presignedUrl,
					expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
				};
			} catch (error) {
				console.error(
					"getPresignedUrl: Failed to generate presigned URL:",
					error,
				);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to generate presigned URL",
				});
			}
		}),

	reassignFace: publicProcedure
		.input(
			z.object({
				faceId: z.number(),
				newPersonId: z.number().nullable(), // null means unassign (make unknown)
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// Get the current face assignment with related data
			const currentFace = await ctx.db.query.photoFaces.findFirst({
				where: eq(photoFaces.id, input.faceId),
				with: {
					photo: true,
					person: true,
				},
			});

			if (!currentFace) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Face not found",
				});
			}

			// If reassigning to a new person, validate the new person exists
			if (input.newPersonId) {
				const newPerson = await ctx.db.query.people.findFirst({
					where: eq(people.id, input.newPersonId),
				});

				if (!newPerson) {
					throw new TRPCError({
						code: "NOT_FOUND",
						message: "New person not found",
					});
				}
			}

			// Remove from AWS Rekognition collection if currently assigned and has real AWS face ID
			if (currentFace.awsFaceId && isFaceRecognitionConfigured()) {
				// Check if this is a real AWS face ID (UUID format) vs a placeholder ID
				const isRealAwsFaceId =
					/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
						currentFace.awsFaceId,
					);

				if (isRealAwsFaceId) {
					try {
						await deleteFacesFromCollection([currentFace.awsFaceId]);
						console.log(
							`Removed face ${currentFace.awsFaceId} from AWS collection for reassignment`,
						);
					} catch (error) {
						console.warn("Failed to remove face from AWS collection:", error);
						// Continue with reassignment even if AWS deletion fails
					}
				} else {
					console.log(
						`Face ${currentFace.awsFaceId} is a placeholder ID, skipping AWS deletion`,
					);
				}
			}

			// Update the face assignment
			const updateData: any = {
				personId: input.newPersonId,
				awsFaceId: null, // Clear AWS face ID since we removed it from collection
				isConfirmed: input.newPersonId !== null, // Confirmed if assigned, unconfirmed if unassigned
				reviewStatus: input.newPersonId !== null ? "confirmed" : "pending",
			};

			const [updatedFace] = await ctx.db
				.update(photoFaces)
				.set(updateData)
				.where(eq(photoFaces.id, input.faceId))
				.returning();

			if (!updatedFace) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Face not found during update",
				});
			}

			// If assigning to a new person, index the face in AWS collection
			if (
				input.newPersonId &&
				currentFace.photo &&
				isFaceRecognitionConfigured()
			) {
				try {
					const indexResult = await indexNewFace(
						input.newPersonId,
						currentFace.photo.s3Key,
						`face-${input.faceId}-person-${input.newPersonId}-reassigned`,
					);

					if (indexResult.success && indexResult.awsFaceId) {
						// Update with the new AWS face ID
						await ctx.db
							.update(photoFaces)
							.set({
								awsFaceId: indexResult.awsFaceId,
							})
							.where(eq(photoFaces.id, input.faceId));
					}
				} catch (error) {
					console.warn("Failed to index reassigned face:", error);
					// Don't throw - reassignment should succeed even if indexing fails
				}
			}

			return {
				success: true,
				message: input.newPersonId
					? "Face reassigned successfully"
					: "Face unmarked successfully",
				face: updatedFace,
			};
		}),
});
