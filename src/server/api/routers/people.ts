import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { faceEncodings, people, photoFaces } from "~/server/db/schema";

export const peopleRouter = createTRPCRouter({
	create: publicProcedure
		.input(
			z.object({
				name: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const [person] = await ctx.db
					.insert(people)
					.values({
						name: input.name,
					})
					.returning();

				if (!person) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create person",
					});
				}

				return person;
			} catch (error) {
				console.error("Create person error:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create person",
				});
			}
		}),

	getAll: publicProcedure
		.input(
			z.object({
				limit: z.number().min(1).max(100).default(50),
				offset: z.number().min(0).default(0),
			}),
		)
		.query(async ({ ctx, input }) => {
			const allPeople = await ctx.db.query.people.findMany({
				limit: input.limit,
				offset: input.offset,
				orderBy: (people, { asc }) => [asc(people.name)],
				with: {
					faceEncodings: true,
				},
			});

			return allPeople;
		}),

	getById: publicProcedure
		.input(z.object({ id: z.number() }))
		.query(async ({ ctx, input }) => {
			const person = await ctx.db.query.people.findFirst({
				where: eq(people.id, input.id),
				with: {
					faceEncodings: true,
					photoFaces: {
						with: {
							photo: true,
						},
					},
				},
			});

			if (!person) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Person not found",
				});
			}

			return person;
		}),

	update: publicProcedure
		.input(
			z.object({
				id: z.number(),
				name: z.string().min(1).max(255),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [updatedPerson] = await ctx.db
				.update(people)
				.set({
					name: input.name,
					updatedAt: new Date(),
				})
				.where(eq(people.id, input.id))
				.returning();

			if (!updatedPerson) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Person not found",
				});
			}

			return updatedPerson;
		}),

	delete: publicProcedure
		.input(z.object({ id: z.number() }))
		.mutation(async ({ ctx, input }) => {
			// TODO: Remove face encodings from AWS Rekognition collection

			// Delete associated face encodings and photo faces
			await ctx.db
				.delete(faceEncodings)
				.where(eq(faceEncodings.personId, input.id));
			await ctx.db.delete(photoFaces).where(eq(photoFaces.personId, input.id));

			// Delete the person
			const [deletedPerson] = await ctx.db
				.delete(people)
				.where(eq(people.id, input.id))
				.returning();

			if (!deletedPerson) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Person not found",
				});
			}

			return { success: true, message: "Person deleted successfully" };
		}),

	addFaceEncoding: publicProcedure
		.input(
			z.object({
				personId: z.number(),
				awsFaceId: z.string(),
				confidence: z.number().min(0).max(100),
				imageUrl: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			try {
				const [faceEncoding] = await ctx.db
					.insert(faceEncodings)
					.values({
						personId: input.personId,
						awsFaceId: input.awsFaceId,
						confidence: input.confidence,
						imageUrl: input.imageUrl,
					})
					.returning();

				if (!faceEncoding) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to add face encoding",
					});
				}

				return faceEncoding;
			} catch (error) {
				console.error("Add face encoding error:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to add face encoding",
				});
			}
		}),

	search: publicProcedure
		.input(
			z.object({
				query: z.string().min(1),
			}),
		)
		.query(async ({ ctx, input }) => {
			// Simple name search - could be enhanced with fuzzy matching
			const results = await ctx.db.query.people.findMany({
				where: (people, { ilike }) => ilike(people.name, `%${input.query}%`),
				limit: 10,
				with: {
					faceEncodings: true,
				},
			});

			return results;
		}),
});
