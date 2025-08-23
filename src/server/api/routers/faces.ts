import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { faceEncodings, photoFaces } from "~/server/db/schema";
import {
	deleteFacesFromCollection,
	listFacesInCollection,
} from "~/server/services/localFaceRecognition";

export const facesRouter = createTRPCRouter({
	getAll: publicProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(500).default(100),
				offset: z.number().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const allFaceEncodings = await ctx.db.query.faceEncodings.findMany({
				limit: input.limit,
				offset: input.offset,
				orderBy: (faceEncodings, { desc }) => [desc(faceEncodings.createdAt)],
				with: {
					person: true,
				},
			});

			// For each face encoding, get all associated photo faces for display
			const enrichedFaceEncodings = await Promise.all(
				allFaceEncodings.map(async (faceEncoding) => {
					// Get all photoFaces that reference this AWS face ID
					const associatedPhotoFaces = await ctx.db.query.photoFaces.findMany({
						where: eq(photoFaces.awsFaceId, faceEncoding.awsFaceId),
						with: {
							photo: true,
						},
						orderBy: (photoFaces, { desc }) => [
							desc(photoFaces.confidence),
							desc(photoFaces.faceQuality),
						],
					});

					// Select the best photo face for preview (highest confidence/quality)
					const bestPhotoFace = associatedPhotoFaces[0];

					return {
						...faceEncoding,
						associatedPhotoFaces,
						bestPhotoFace,
						totalInstances: associatedPhotoFaces.length,
					};
				}),
			);

			return enrichedFaceEncodings;
		}),

	getByPersonId: publicProcedure
		.input(z.object({ personId: z.number() }))
		.query(async ({ ctx, input }) => {
			const faceEncodingsForPerson = await ctx.db.query.faceEncodings.findMany({
				where: eq(faceEncodings.personId, input.personId),
				orderBy: (faceEncodings, { desc }) => [desc(faceEncodings.createdAt)],
				with: {
					person: true,
				},
			});

			return faceEncodingsForPerson;
		}),

	findDuplicates: publicProcedure.query(async ({ ctx }) => {
		// Find people who have multiple face encodings
		const duplicates = await ctx.db.query.faceEncodings.findMany({
			with: {
				person: true,
			},
		});

		// Group by person ID and find those with multiple encodings
		const grouped = duplicates.reduce(
			(acc, encoding) => {
				if (!encoding.personId) return acc;

				if (!acc[encoding.personId]) {
					acc[encoding.personId] = {
						person: encoding.person,
						encodings: [],
					};
				}

				acc[encoding.personId]?.encodings.push(encoding);
				return acc;
			},
			{} as Record<
				number,
				{
					person: any;
					encodings: typeof duplicates;
				}
			>,
		);

		// Filter to only people with multiple face encodings
		const duplicateGroups = Object.values(grouped).filter(
			(group) => group.encodings.length > 1,
		);

		// Enrich each duplicate group with photo face data
		const enrichedDuplicateGroups = await Promise.all(
			duplicateGroups.map(async (group) => {
				const enrichedEncodings = await Promise.all(
					group.encodings.map(async (encoding) => {
						// Get all photoFaces that reference this AWS face ID
						const associatedPhotoFaces = await ctx.db.query.photoFaces.findMany(
							{
								where: eq(photoFaces.awsFaceId, encoding.awsFaceId),
								with: {
									photo: true,
								},
								orderBy: (photoFaces, { desc }) => [
									desc(photoFaces.confidence),
									desc(photoFaces.faceQuality),
								],
							},
						);

						const bestPhotoFace = associatedPhotoFaces[0];

						return {
							...encoding,
							associatedPhotoFaces,
							bestPhotoFace,
							totalInstances: associatedPhotoFaces.length,
						};
					}),
				);

				return {
					person: group.person,
					encodings: enrichedEncodings,
				};
			}),
		);

		return enrichedDuplicateGroups;
	}),

	delete: publicProcedure
		.input(z.object({ faceEncodingId: z.number() }))
		.mutation(async ({ ctx, input }) => {
			// Get the face encoding to delete
			const faceEncoding = await ctx.db.query.faceEncodings.findFirst({
				where: eq(faceEncodings.id, input.faceEncodingId),
			});

			if (!faceEncoding) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Face encoding not found",
				});
			}

			// Use transaction for atomic deletion
			await ctx.db.transaction(async (tx) => {
				// Step 1: Delete from AWS Rekognition collection
				const awsDeleteResult = await deleteFacesFromCollection([
					faceEncoding.awsFaceId,
				]);

				if (!awsDeleteResult.success) {
					console.warn(
						`Failed to delete face from AWS Rekognition: ${awsDeleteResult.error}`,
					);
					// Continue with database deletion even if AWS fails
					// This handles cases where face was already deleted from AWS
				}

				// Step 2: Delete related photo faces that reference this AWS face ID
				await tx
					.delete(photoFaces)
					.where(eq(photoFaces.awsFaceId, faceEncoding.awsFaceId));

				// Step 3: Delete the face encoding record
				await tx
					.delete(faceEncodings)
					.where(eq(faceEncodings.id, input.faceEncodingId));
			});

			return {
				success: true,
				message: "Face encoding deleted successfully",
			};
		}),

	bulkDelete: publicProcedure
		.input(z.object({ faceEncodingIds: z.array(z.number()).min(1) }))
		.mutation(async ({ ctx, input }) => {
			// Get all face encodings to delete
			const faceEncodingsToDelete = await Promise.all(
				input.faceEncodingIds.map((id) =>
					ctx.db.query.faceEncodings.findFirst({
						where: eq(faceEncodings.id, id),
					}),
				),
			);

			// Filter out any not found
			const validFaceEncodings = faceEncodingsToDelete.filter(
				(encoding) => encoding !== undefined,
			);

			if (validFaceEncodings.length === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "No valid face encodings found",
				});
			}

			// Use transaction for atomic deletion
			await ctx.db.transaction(async (tx) => {
				// Step 1: Delete from AWS Rekognition collection (batch)
				const awsFaceIds = validFaceEncodings.map(
					(encoding) => encoding?.awsFaceId,
				);
				const awsDeleteResult = await deleteFacesFromCollection(awsFaceIds);

				if (!awsDeleteResult.success) {
					console.warn(
						`Failed to delete faces from AWS Rekognition: ${awsDeleteResult.error}`,
					);
					// Continue with database deletion even if AWS fails
				}

				// Step 2: Delete related photo faces for all AWS face IDs
				for (const faceId of awsFaceIds) {
					await tx.delete(photoFaces).where(eq(photoFaces.awsFaceId, faceId));
				}

				// Step 3: Delete all face encoding records
				for (const id of input.faceEncodingIds) {
					await tx.delete(faceEncodings).where(eq(faceEncodings.id, id));
				}
			});

			return {
				success: true,
				deletedCount: validFaceEncodings.length,
				message: `Successfully deleted ${validFaceEncodings.length} face encodings`,
			};
		}),

	listAwsFaces: publicProcedure.query(async () => {
		// List faces directly from AWS Rekognition collection
		const awsFacesResult = await listFacesInCollection();

		if (!awsFacesResult.success) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to list AWS faces: ${awsFacesResult.error}`,
			});
		}

		return awsFacesResult.faces || [];
	}),

	syncWithAws: publicProcedure.mutation(async ({ ctx }) => {
		// Get faces from AWS
		const awsFacesResult = await listFacesInCollection();
		if (!awsFacesResult.success || !awsFacesResult.faces) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Failed to list AWS faces: ${awsFacesResult.error}`,
			});
		}

		// Get faces from our database
		const dbFaces = await ctx.db.query.faceEncodings.findMany();

		const awsFaceIds = new Set(awsFacesResult.faces.map((face) => face.faceId));
		const dbFaceIds = new Set(dbFaces.map((face) => face.awsFaceId));

		// Find orphaned database records (exist in DB but not in AWS)
		const orphanedDbFaces = dbFaces.filter(
			(face) => !awsFaceIds.has(face.awsFaceId),
		);

		// Find orphaned AWS faces (exist in AWS but not in DB)
		const orphanedAwsFaces = awsFacesResult.faces.filter(
			(face) => !dbFaceIds.has(face.faceId),
		);

		return {
			totalAwsFaces: awsFacesResult.faces.length,
			totalDbFaces: dbFaces.length,
			orphanedDbFaces: orphanedDbFaces.length,
			orphanedAwsFaces: orphanedAwsFaces.length,
			orphanedDbFacesList: orphanedDbFaces,
			orphanedAwsFacesList: orphanedAwsFaces,
		};
	}),
});
