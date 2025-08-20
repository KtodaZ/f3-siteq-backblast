import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import {
	boolean,
	index,
	integer,
	jsonb,
	pgTableCreator,
	real,
	serial,
	timestamp,
	varchar,
} from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator(
	(name) => `f3-siteq-backblast_${name}`,
);

export const users = createTable("users", {
	id: varchar("id", { length: 255 }).notNull().primaryKey(),
	name: varchar("name", { length: 255 }),
	email: varchar("email", { length: 255 }).notNull(),
	emailVerified: timestamp("emailVerified", { mode: "date" }),
	image: varchar("image", { length: 255 }),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const accounts = createTable(
	"accounts",
	{
		userId: varchar("userId", { length: 255 })
			.notNull()
			.references(() => users.id),
		type: varchar("type", { length: 255 }).notNull(),
		provider: varchar("provider", { length: 255 }).notNull(),
		providerAccountId: varchar("providerAccountId", { length: 255 }).notNull(),
		refresh_token: varchar("refresh_token"),
		access_token: varchar("access_token"),
		expires_at: integer("expires_at"),
		token_type: varchar("token_type", { length: 255 }),
		scope: varchar("scope", { length: 255 }),
		id_token: varchar("id_token"),
		session_state: varchar("session_state", { length: 255 }),
	},
	(account) => [
		index("account_userId_idx").on(account.userId),
	]
);

export const sessions = createTable("sessions", {
	sessionToken: varchar("sessionToken", { length: 255 })
		.notNull()
		.primaryKey(),
	userId: varchar("userId", { length: 255 })
		.notNull()
		.references(() => users.id),
	expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = createTable(
	"verificationTokens",
	{
		identifier: varchar("identifier", { length: 255 }).notNull(),
		token: varchar("token", { length: 255 }).notNull(),
		expires: timestamp("expires", { mode: "date" }).notNull(),
	},
	(vt) => [
		index("verificationToken_token_idx").on(vt.token),
	]
);

export const people = createTable("people", {
	id: serial("id").primaryKey(),
	name: varchar("name", { length: 255 }).notNull(),
	createdAt: timestamp("created_at").defaultNow(),
	updatedAt: timestamp("updated_at").defaultNow(),
});

export const faceEncodings = createTable("face_encodings", {
	id: serial("id").primaryKey(),
	personId: integer("person_id").references(() => people.id),
	awsFaceId: varchar("aws_face_id", { length: 255 }).unique().notNull(),
	confidence: real("confidence"),
	imageUrl: varchar("image_url", { length: 500 }),
	createdAt: timestamp("created_at").defaultNow(),
});

export const photos = createTable("photos", {
	id: serial("id").primaryKey(),
	filename: varchar("filename", { length: 255 }).notNull(),
	s3Key: varchar("s3_key", { length: 500 }).notNull(),
	uploadDate: timestamp("upload_date").defaultNow(),
	processingStatus: varchar("processing_status", { length: 50 }).default(
		"pending",
	),
	faceCount: integer("face_count").default(0),
	// Enhanced metadata fields for face recognition optimization
	imageWidth: integer("image_width"),
	imageHeight: integer("image_height"),
	averageFaceSize: real("average_face_size"), // Average pixels per face
	processingAttempts: integer("processing_attempts").default(0),
	lastError: varchar("last_error", { length: 1000 }),
	preprocessed: boolean("preprocessed").default(false),
	enhancementApplied: varchar("enhancement_applied", { length: 100 }),
});

export const photoFaces = createTable("photo_faces", {
	id: serial("id").primaryKey(),
	photoId: integer("photo_id").references(() => photos.id),
	personId: integer("person_id").references(() => people.id),
	awsFaceId: varchar("aws_face_id", { length: 255 }),
	confidence: real("confidence"),
	boundingBox: jsonb("bounding_box"),
	isConfirmed: boolean("is_confirmed").default(false),
	// Enhanced face quality metrics
	faceQuality: real("face_quality"), // 0-100 quality score
	detectionMethod: varchar("detection_method", { length: 50 }), // 'group_photo', 'enhanced', etc.
	reviewStatus: varchar("review_status", { length: 20 }).default("pending"), // 'pending', 'confirmed', 'review', 'rejected'
	boundingBoxQuality: real("bounding_box_quality"), // Face boundary clarity
	faceSize: real("face_size"), // Size in pixels
});

// Keep the posts table for now to avoid breaking existing tRPC routes
export const posts = createTable(
	"post",
	(d) => ({
		id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
		name: d.varchar({ length: 256 }),
		createdAt: d
			.timestamp({ withTimezone: true })
			.default(sql`CURRENT_TIMESTAMP`)
			.notNull(),
		updatedAt: d.timestamp({ withTimezone: true }).$onUpdate(() => new Date()),
	}),
	(t) => [index("name_idx").on(t.name)],
);

// Relations
export const peopleRelations = relations(people, ({ many }) => ({
	faceEncodings: many(faceEncodings),
	photoFaces: many(photoFaces),
}));

export const faceEncodingsRelations = relations(faceEncodings, ({ one }) => ({
	person: one(people, {
		fields: [faceEncodings.personId],
		references: [people.id],
	}),
}));

export const photosRelations = relations(photos, ({ many }) => ({
	photoFaces: many(photoFaces),
}));

export const photoFacesRelations = relations(photoFaces, ({ one }) => ({
	photo: one(photos, {
		fields: [photoFaces.photoId],
		references: [photos.id],
	}),
	person: one(people, {
		fields: [photoFaces.personId],
		references: [people.id],
	}),
}));
