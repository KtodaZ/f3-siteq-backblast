import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { faceEncodings, people, photoFaces, photos } from "~/server/db/schema";
import {
	deleteFacesFromCollection,
	indexNewFace,
	isFaceRecognitionConfigured,
} from "~/server/services/localFaceRecognition";

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

	createPersonWithFace: publicProcedure
		.input(
			z.object({
				name: z.string().min(1).max(255),
				faceId: z.number(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			// 🔍 ULTRA-DEBUG: Add unhandled promise rejection tracking
			const originalProcessHandler = process.listeners('unhandledRejection');
			const customRejectionHandler = (reason: any, promise: Promise<any>) => {
				console.error(`🚨 ULTRA-DEBUG: Unhandled promise rejection during createPersonWithFace:`, reason);
				console.error(`🚨 ULTRA-DEBUG: Promise:`, promise);
			};
			process.on('unhandledRejection', customRejectionHandler);

			// 🔍 ULTRA-DEBUG: Database connection info
			console.log(`🔌 ULTRA-DEBUG: Database connection info:`, {
				connectionString: process.env.DATABASE_URL?.substring(0, 50) + '...',
				timestamp: new Date().toISOString(),
			});

			try {
				console.log(
					`🚀 Starting atomic person creation with face indexing: "${input.name}" for face ${input.faceId}`,
				);

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

				// Check if face is already assigned to someone
				if (faceWithPhoto.personId) {
					console.error(`❌ Face ${input.faceId} is already assigned to person ${faceWithPhoto.personId}`);
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: `Face is already assigned to person ID ${faceWithPhoto.personId}`,
					});
				}
				
				console.log(`✅ Face ${input.faceId} is available for assignment`);

				// Check if person with this name already exists
				const existingPerson = await ctx.db.query.people.findFirst({
					where: (people, { eq }) => eq(people.name, input.name),
				});
				
				if (existingPerson) {
					console.log(`⚠️ Person "${input.name}" already exists with ID ${existingPerson.id} - this may be intentional for multiple face encodings`);
				} else {
					console.log(`✅ Person name "${input.name}" is unique`);
				}

				// Use a database transaction to ensure atomicity  
				console.log(`🏁 Starting database transaction for person creation`);
				
				// 🔍 ULTRA-DEBUG: Add connection info before transaction
				try {
					const preTransactionTest = await ctx.db.execute(sql`SELECT pg_backend_pid() as backend_pid, txid_current() as transaction_id`);
					console.log(`🔌 PRE-TRANSACTION: Connection info:`, preTransactionTest.rows[0]);
				} catch (preTransactionError) {
					console.error(`❌ PRE-TRANSACTION: Error getting connection info:`, preTransactionError);
				}
				
				let result;
				try {
					result = await ctx.db.transaction(async (tx) => {
					console.log(`📊 Inside transaction: attempting to create person and assign face`);
					
					// 🔍 ULTRA-DEBUG: Check connection info within transaction
					try {
						const inTransactionTest = await tx.execute(sql`SELECT pg_backend_pid() as backend_pid, txid_current() as transaction_id`);
						console.log(`🔌 IN-TRANSACTION: Connection info:`, inTransactionTest.rows[0]);
					} catch (inTransactionError) {
						console.error(`❌ IN-TRANSACTION: Error getting connection info:`, inTransactionError);
					}
					// Step 1: Create the person
					console.log(`👤 Creating person: "${input.name}"`);
					const [person] = await tx
						.insert(people)
						.values({
							name: input.name,
						})
						.returning();

					if (!person) {
						console.error(`❌ Person creation failed - no record returned`);
						throw new TRPCError({
							code: "INTERNAL_SERVER_ERROR",
							message: "Failed to create person",
						});
					}

					console.log(`✅ Created person ${person.id}: "${person.name}" in transaction`);

					// Step 2: Assign face to person
					console.log(
						`🔗 Assigning face ${input.faceId} to person ${person.id}`,
					);
					const [updatedFace] = await tx
						.update(photoFaces)
						.set({
							personId: person.id,
							isConfirmed: true,
						})
						.where(eq(photoFaces.id, input.faceId))
						.returning();

					if (!updatedFace) {
						console.error(`❌ Face assignment failed - no record returned for face ${input.faceId}`);
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Face not found during assignment",
						});
					}

					console.log(
						`✅ Assigned face ${input.faceId} to person ${person.id} in transaction`,
					);

					// Step 3: Index the face for future recognition if AWS is configured
					if (isFaceRecognitionConfigured() && faceWithPhoto.photo) {
						console.log(`🔍 Starting face indexing for person ${person.id}`);

						const indexResult = await indexNewFace(
							person.id,
							faceWithPhoto.photo.s3Key,
							`face-${input.faceId}-person-${person.id}`,
							tx, // Pass the transaction to avoid nested transaction issue
						);

						if (!indexResult.success) {
							console.error(`❌ Face indexing failed: ${indexResult.error}`);
							console.error(`❌ Rolling back entire transaction due to indexing failure`);
							// Throw error to rollback the entire transaction
							throw new TRPCError({
								code: "INTERNAL_SERVER_ERROR",
								message: `Failed to index face for recognition: ${indexResult.error}`,
							});
						}

						console.log(
							`✅ Face indexing successful in transaction, AWS Face ID: ${indexResult.awsFaceId}`,
						);

						// Step 4: Update the photo face record with the AWS face ID
						const [updatedFaceWithAwsId] = await tx
							.update(photoFaces)
							.set({
								awsFaceId: indexResult.awsFaceId,
							})
							.where(eq(photoFaces.id, input.faceId))
							.returning();

						if (!updatedFaceWithAwsId) {
							console.error(`❌ Failed to update face ${input.faceId} with AWS Face ID ${indexResult.awsFaceId}`);
							throw new TRPCError({
								code: "INTERNAL_SERVER_ERROR",
								message: "Failed to update face with AWS Face ID",
							});
						}

						console.log(
							`✅ Successfully linked photoFace ${input.faceId} to AWS Face ID ${indexResult.awsFaceId} in transaction`,
						);

						// 🔍 ULTRA-DEBUG: Raw SQL verification within transaction
						console.log(`🔍 RAW-SQL: Verifying data exists within transaction using raw SQL...`);
						
						try {
							// Use raw SQL to verify the person exists within the transaction
							const rawPersonQuery = await tx.execute(sql`SELECT id, name FROM "f3-siteq-backblast_people" WHERE id = ${person.id}`);
							console.log(`🔍 RAW-SQL: Person query result:`, rawPersonQuery.rows);
							
							// Use raw SQL to verify the face assignment exists within the transaction  
							const rawFaceQuery = await tx.execute(sql`SELECT id, person_id, aws_face_id FROM "f3-siteq-backblast_photo_faces" WHERE id = ${input.faceId}`);
							console.log(`🔍 RAW-SQL: Face query result:`, rawFaceQuery.rows);
							
							// Use raw SQL to verify the face encoding exists within the transaction
							const rawEncodingQuery = await tx.execute(sql`SELECT id, person_id, aws_face_id FROM "f3-siteq-backblast_face_encodings" WHERE person_id = ${person.id}`);
							console.log(`🔍 RAW-SQL: Face encoding query result:`, rawEncodingQuery.rows);
							
							// Check if all expected records exist within transaction
							if (rawPersonQuery.rows.length === 0) {
								console.error(`❌ RAW-SQL: Person ${person.id} NOT found within transaction!`);
							} else {
								console.log(`✅ RAW-SQL: Person ${person.id} found within transaction`);
							}
							
							if (rawFaceQuery.rows.length === 0 || rawFaceQuery.rows[0].person_id != person.id) {
								console.error(`❌ RAW-SQL: Face ${input.faceId} NOT properly assigned within transaction!`);
							} else {
								console.log(`✅ RAW-SQL: Face ${input.faceId} properly assigned within transaction`);
							}
							
							if (rawEncodingQuery.rows.length === 0) {
								console.error(`❌ RAW-SQL: Face encoding NOT found for person ${person.id} within transaction!`);
							} else {
								console.log(`✅ RAW-SQL: Face encoding found for person ${person.id} within transaction`);
							}
							
						} catch (rawSqlError) {
							console.error(`❌ RAW-SQL: Error during raw SQL verification:`, rawSqlError);
						}

						// 🔍 ULTRA-DEBUG: Check transaction state before commit
						try {
							const transactionState = await tx.execute(sql`SELECT 
								pg_backend_pid() as backend_pid,
								txid_current() as transaction_id,
								pg_is_in_recovery() as in_recovery,
								current_setting('transaction_isolation') as isolation_level,
								current_setting('transaction_read_only') as read_only
							`);
							console.log(`🔍 PRE-COMMIT: Transaction state:`, transactionState.rows[0]);
						} catch (preCommitError) {
							console.error(`❌ PRE-COMMIT: Error getting transaction state:`, preCommitError);
						}

						console.log(`🎯 Transaction completed successfully - about to commit all changes`);
						return { person, face: updatedFaceWithAwsId, indexed: true };
					}
					// Face recognition not configured - warn but allow creation
					if (!isFaceRecognitionConfigured()) {
						console.log(
							`⚠️ Face recognition not configured, person created but won't be recognizable in future photos`,
						);
					}
					if (!faceWithPhoto.photo) {
						console.log(`⚠️ No photo data found for face ${input.faceId}`);
					}

					console.log(`🎯 Transaction completed successfully - about to commit (no indexing)`);
					return { person, face: updatedFace, indexed: false };
				});
				
				console.log(`✅ TRANSACTION: Database transaction function completed successfully`);
				
				// 🔍 ULTRA-DEBUG: Check connection info after transaction
				try {
					const postTransactionTest = await ctx.db.execute(sql`SELECT pg_backend_pid() as backend_pid, txid_current() as transaction_id`);
					console.log(`🔌 POST-TRANSACTION: Connection info:`, postTransactionTest.rows[0]);
				} catch (postTransactionError) {
					console.error(`❌ POST-TRANSACTION: Error getting connection info:`, postTransactionError);
				}
				
				} catch (transactionError) {
					console.error(`❌ TRANSACTION: Database transaction failed:`, transactionError);
					console.error(`❌ TRANSACTION: Error type: ${transactionError?.constructor?.name}`);
					console.error(`❌ TRANSACTION: Error message: ${transactionError?.message}`);
					console.error(`❌ TRANSACTION: Full error:`, transactionError);
					
					// Re-throw to be caught by outer try-catch
					throw transactionError;
				}

				console.log(
					`🎉 Database transaction committed successfully for "${input.name}"`,
				);
				console.log(`📊 Final result: person ID ${result.person.id}, face ID ${result.face.id}, indexed: ${result.indexed}`);

				// 🔍 ULTRA-DEBUG: Immediately verify the data exists in the database
				console.log(`🔍 VERIFICATION: Checking if person ${result.person.id} exists in database...`);
				try {
					const verifyPerson = await ctx.db.query.people.findFirst({
						where: eq(people.id, result.person.id),
					});
					
					if (verifyPerson) {
						console.log(`✅ VERIFICATION SUCCESS: Person ${result.person.id} "${verifyPerson.name}" found in database immediately after transaction`);
					} else {
						console.error(`❌ VERIFICATION FAILED: Person ${result.person.id} NOT found in database immediately after transaction - THIS IS THE BUG!`);
					}
				} catch (verifyError) {
					console.error(`❌ VERIFICATION ERROR: Failed to query person ${result.person.id}:`, verifyError);
				}

				// 🔍 ULTRA-DEBUG: Verify the face assignment
				console.log(`🔍 VERIFICATION: Checking if face ${result.face.id} is assigned...`);
				try {
					const verifyFace = await ctx.db.query.photoFaces.findFirst({
						where: eq(photoFaces.id, result.face.id),
					});
					
					if (verifyFace) {
						console.log(`✅ VERIFICATION SUCCESS: Face ${result.face.id} assigned to person ${verifyFace.personId}, awsFaceId: ${verifyFace.awsFaceId}`);
					} else {
						console.error(`❌ VERIFICATION FAILED: Face ${result.face.id} NOT found in database immediately after transaction`);
					}
				} catch (verifyError) {
					console.error(`❌ VERIFICATION ERROR: Failed to query face ${result.face.id}:`, verifyError);
				}

				// 🔍 ULTRA-DEBUG: Verify the face encoding if indexed
				if (result.indexed) {
					console.log(`🔍 VERIFICATION: Checking if face encoding was created...`);
					try {
						const verifyEncoding = await ctx.db.query.faceEncodings.findFirst({
							where: eq(faceEncodings.personId, result.person.id),
						});
						
						if (verifyEncoding) {
							console.log(`✅ VERIFICATION SUCCESS: Face encoding ${verifyEncoding.id} found for person ${result.person.id}, awsFaceId: ${verifyEncoding.awsFaceId}`);
						} else {
							console.error(`❌ VERIFICATION FAILED: Face encoding NOT found for person ${result.person.id} immediately after transaction`);
						}
					} catch (verifyError) {
						console.error(`❌ VERIFICATION ERROR: Failed to query face encoding for person ${result.person.id}:`, verifyError);
					}
				}

				console.log(`🏁 ULTRA-DEBUG: All verifications completed, proceeding with return...`);

				const finalResult = {
					success: true,
					person: result.person,
					face: result.face,
					indexed: result.indexed,
					message: result.indexed
						? `Person "${input.name}" created and face indexed for future recognition`
						: `Person "${input.name}" created but face recognition is not configured - they won't be recognizable in future photos`,
				};

				console.log(`🎬 ULTRA-DEBUG: About to return from createPersonWithFace procedure with result:`, {
					success: finalResult.success,
					personId: finalResult.person.id,
					faceId: finalResult.face.id,
					indexed: finalResult.indexed,
				});

				// 🔍 ULTRA-DEBUG: Set up post-return verification (delayed check)
				setTimeout(async () => {
					console.log(`🕐 ULTRA-DEBUG: Post-return verification (5 seconds later)...`);
					try {
						const postReturnPerson = await ctx.db.query.people.findFirst({
							where: eq(people.id, result.person.id),
						});
						
						if (postReturnPerson) {
							console.log(`✅ POST-RETURN SUCCESS: Person ${result.person.id} still exists 5 seconds after return`);
						} else {
							console.error(`❌ POST-RETURN FAILURE: Person ${result.person.id} DISAPPEARED 5 seconds after return - ROLLBACK DETECTED!`);
						}
					} catch (postError) {
						console.error(`❌ POST-RETURN ERROR:`, postError);
					}
				}, 5000);

				return finalResult;
			} catch (error) {
				console.error(`❌ Atomic person creation with face error for "${input.name}":`, error);
				console.error(`❌ Error type: ${error?.constructor?.name}`);
				console.error(`❌ Error message: ${error?.message}`);
				console.error(`❌ Full error:`, error);
				
				if (error instanceof TRPCError) {
					throw error;
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create person with face indexing",
				});
			} finally {
				// 🔍 ULTRA-DEBUG: Clean up promise rejection handler
				process.off('unhandledRejection', customRejectionHandler);
				console.log(`🧹 ULTRA-DEBUG: Cleaned up promise rejection handler for createPersonWithFace`);
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
					photoFaces: {
						with: {
							photo: true,
						},
						orderBy: (photoFaces, { desc }) => [
							desc(photoFaces.confidence),
							desc(photoFaces.faceQuality),
						],
					},
				},
			});

			// Enrich each person with their best photo face for display
			const enrichedPeople = allPeople.map((person) => {
				// Find the best photo face (highest confidence/quality)
				const bestPhotoFace = person.photoFaces?.[0];

				return {
					...person,
					bestPhotoFace,
				};
			});

			return enrichedPeople;
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
			try {
				console.log(`🗑️ Starting atomic person deletion for person ${input.id}`);

				// Use atomic transaction to ensure all operations succeed or fail together
				const result = await ctx.db.transaction(async (tx) => {
					// Step 1: Get the person and their associated face data before deletion
					const personWithFaces = await tx.query.people.findFirst({
						where: eq(people.id, input.id),
						with: {
							faceEncodings: true,
							photoFaces: true,
						},
					});

					if (!personWithFaces) {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Person not found",
						});
					}

					console.log(
						`👤 Found person "${personWithFaces.name}" with ${personWithFaces.faceEncodings.length} face encodings and ${personWithFaces.photoFaces.length} photo faces`,
					);

					// Step 2: Remove face encodings from AWS Rekognition collection
					if (
						isFaceRecognitionConfigured() &&
						personWithFaces.faceEncodings.length > 0
					) {
						const awsFaceIds = personWithFaces.faceEncodings
							.map((encoding) => encoding.awsFaceId)
							.filter((faceId) => faceId); // Only include non-null face IDs

						if (awsFaceIds.length > 0) {
							console.log(
								`🔍 Removing ${awsFaceIds.length} faces from AWS Rekognition collection`,
							);

							const deleteResult = await deleteFacesFromCollection(awsFaceIds);
							if (!deleteResult.success) {
								console.error(
									`❌ Failed to delete faces from AWS collection: ${deleteResult.error}`,
								);
								// Don't throw - continue with database deletion even if AWS cleanup fails
								console.warn(
									"⚠️ Continuing with person deletion despite AWS cleanup failure",
								);
							} else {
								console.log(
									`✅ Successfully removed ${deleteResult.deletedFaceIds?.length || 0} faces from AWS collection`,
								);
							}
						}
					}

					// Step 3: Delete associated face encodings from database
					console.log(`🗑️ Deleting face encodings for person ${input.id}`);
					const deletedEncodings = await tx
						.delete(faceEncodings)
						.where(eq(faceEncodings.personId, input.id))
						.returning();

					console.log(`✅ Deleted ${deletedEncodings.length} face encodings`);

					// Step 4: Update photo faces to remove person association (set to null rather than delete)
					// This preserves the detected face data while removing the person assignment
					console.log(
						`🔗 Removing person assignment from photo faces for person ${input.id}`,
					);
					const updatedPhotoFaces = await tx
						.update(photoFaces)
						.set({
							personId: null,
							awsFaceId: null,
							isConfirmed: false,
							reviewStatus: "pending",
						})
						.where(eq(photoFaces.personId, input.id))
						.returning();

					console.log(
						`✅ Updated ${updatedPhotoFaces.length} photo faces to remove person assignment`,
					);

					// Step 5: Delete the person record
					console.log(`👤 Deleting person ${input.id}`);
					const [deletedPerson] = await tx
						.delete(people)
						.where(eq(people.id, input.id))
						.returning();

					if (!deletedPerson) {
						throw new TRPCError({
							code: "NOT_FOUND",
							message: "Person not found during deletion",
						});
					}

					console.log(`✅ Successfully deleted person "${deletedPerson.name}"`);

					return {
						deletedPerson,
						deletedEncodingsCount: deletedEncodings.length,
						updatedPhotoFacesCount: updatedPhotoFaces.length,
					};
				});

				console.log(
					`🎉 Atomic person deletion completed successfully for "${result.deletedPerson.name}"`,
				);

				return {
					success: true,
					message: `Person "${result.deletedPerson.name}" deleted successfully`,
					details: {
						deletedEncodingsCount: result.deletedEncodingsCount,
						updatedPhotoFacesCount: result.updatedPhotoFacesCount,
					},
				};
			} catch (error) {
				console.error(
					`❌ Person deletion failed for person ${input.id}:`,
					error,
				);
				if (error instanceof TRPCError) {
					throw error;
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to delete person",
				});
			}
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
