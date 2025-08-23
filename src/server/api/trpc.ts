/**
 * YOU PROBABLY DON'T NEED TO EDIT THIS FILE, UNLESS:
 * 1. You want to modify request context (see Part 1).
 * 2. You want to create a new middleware or type of procedure (see Part 3).
 *
 * TL;DR - This is where all the tRPC server stuff is created and plugged in. The pieces you will
 * need to use are documented accordingly near the end.
 */
import { initTRPC } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";

import { db } from "~/server/db";

/**
 * 1. CONTEXT
 *
 * This section defines the "contexts" that are available in the backend API.
 *
 * These allow you to access things when processing a request, like the database, the session, etc.
 *
 * This helper generates the "internals" for a tRPC context. The API handler and RSC clients each
 * wrap this and provides the required context.
 *
 * @see https://trpc.io/docs/server/context
 */
export const createTRPCContext = async (opts: { headers: Headers }) => {
	return {
		db,
		...opts,
	};
};

/**
 * 2. INITIALIZATION
 *
 * This is where the tRPC API is initialized, connecting the context and transformer. We also parse
 * ZodErrors so that you get typesafety on the frontend if your procedure fails due to validation
 * errors on the backend.
 */
const t = initTRPC.context<typeof createTRPCContext>().create({
	transformer: superjson,
	errorFormatter({ shape, error }) {
		return {
			...shape,
			data: {
				...shape.data,
				zodError:
					error.cause instanceof ZodError ? error.cause.flatten() : null,
			},
		};
	},
});

/**
 * Create a server-side caller.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
export const createCallerFactory = t.createCallerFactory;

/**
 * 3. ROUTER & PROCEDURE (THE IMPORTANT BIT)
 *
 * These are the pieces you use to build your tRPC API. You should import these a lot in the
 * "/src/server/api/routers" directory.
 */

/**
 * This is how you create new routers and sub-routers in your tRPC API.
 *
 * @see https://trpc.io/docs/router
 */
export const createTRPCRouter = t.router;

/**
 * Middleware for timing procedure execution and adding an artificial delay in development.
 * Enhanced with ultra-debugging for transaction rollback detection.
 */
const timingMiddleware = t.middleware(async ({ next, path, input }) => {
	const start = Date.now();
	const procedureId = `${path}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
	
	// 🔍 ULTRA-DEBUG: Enhanced logging for createPersonWithFace
	if (path === 'people.createPersonWithFace') {
		console.log(`🎬 ULTRA-DEBUG: tRPC procedure ${path} STARTING with input:`, input);
		console.log(`🆔 ULTRA-DEBUG: Procedure ID: ${procedureId}`);
	}

	if (t._config.isDev) {
		// artificial delay in dev
		const waitMs = Math.floor(Math.random() * 400) + 100;
		await new Promise((resolve) => setTimeout(resolve, waitMs));
	}

	let result;
	let procedureError = null;
	
	try {
		result = await next();
		
		// 🔍 ULTRA-DEBUG: Log successful completion
		if (path === 'people.createPersonWithFace') {
			console.log(`✅ ULTRA-DEBUG: tRPC procedure ${path} COMPLETED SUCCESSFULLY`);
			console.log(`📊 ULTRA-DEBUG: Result preview:`, {
				success: result?.success,
				personId: result?.person?.id,
				faceId: result?.face?.id,
				procedureId,
			});
		}
	} catch (error) {
		procedureError = error;
		
		// 🔍 ULTRA-DEBUG: Log procedure errors
		if (path === 'people.createPersonWithFace') {
			console.error(`❌ ULTRA-DEBUG: tRPC procedure ${path} FAILED with error:`, error);
			console.error(`🆔 ULTRA-DEBUG: Failed procedure ID: ${procedureId}`);
		}
		
		throw error; // Re-throw the error
	}

	const end = Date.now();
	console.log(`[TRPC] ${path} took ${end - start}ms to execute`);

	// 🔍 ULTRA-DEBUG: Final status log
	if (path === 'people.createPersonWithFace') {
		console.log(`🏁 ULTRA-DEBUG: tRPC middleware for ${path} FINISHED - about to return result to client`);
		console.log(`🆔 ULTRA-DEBUG: Final procedure ID: ${procedureId}`);
	}

	return result;
});

/**
 * Public (unauthenticated) procedure
 *
 * This is the base piece you use to build new queries and mutations on your tRPC API. It does not
 * guarantee that a user querying is authorized, but you can still access user session data if they
 * are logged in.
 */
export const publicProcedure = t.procedure.use(timingMiddleware);
