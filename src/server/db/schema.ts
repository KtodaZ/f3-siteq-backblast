import { sql } from "drizzle-orm";
import { index, pgTableCreator, serial, varchar, timestamp, integer, real, jsonb, boolean } from "drizzle-orm/pg-core";

/**
 * This is an example of how to use the multi-project schema feature of Drizzle ORM. Use the same
 * database instance for multiple projects.
 *
 * @see https://orm.drizzle.team/docs/goodies#multi-project-schema
 */
export const createTable = pgTableCreator(
	(name) => `f3-siteq-backblast_${name}`,
);

export const users = createTable('users', {
	id: varchar('id', { length: 255 }).notNull().primaryKey(),
	name: varchar('name', { length: 255 }),
	email: varchar('email', { length: 255 }).notNull(),
	emailVerified: timestamp('emailVerified', { mode: 'date' }),
	image: varchar('image', { length: 255 }),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
});

export const people = createTable('people', {
	id: serial('id').primaryKey(),
	name: varchar('name', { length: 255 }).notNull(),
	createdAt: timestamp('created_at').defaultNow(),
	updatedAt: timestamp('updated_at').defaultNow(),
});

export const faceEncodings = createTable('face_encodings', {
	id: serial('id').primaryKey(),
	personId: integer('person_id').references(() => people.id),
	awsFaceId: varchar('aws_face_id', { length: 255 }).unique().notNull(),
	confidence: real('confidence'),
	imageUrl: varchar('image_url', { length: 500 }),
	createdAt: timestamp('created_at').defaultNow(),
});

export const photos = createTable('photos', {
	id: serial('id').primaryKey(),
	filename: varchar('filename', { length: 255 }).notNull(),
	s3Key: varchar('s3_key', { length: 500 }).notNull(),
	uploadDate: timestamp('upload_date').defaultNow(),
	processingStatus: varchar('processing_status', { length: 50 }).default('pending'),
	faceCount: integer('face_count').default(0),
});

export const photoFaces = createTable('photo_faces', {
	id: serial('id').primaryKey(),
	photoId: integer('photo_id').references(() => photos.id),
	personId: integer('person_id').references(() => people.id),
	awsFaceId: varchar('aws_face_id', { length: 255 }),
	confidence: real('confidence'),
	boundingBox: jsonb('bounding_box'),
	isConfirmed: boolean('is_confirmed').default(false),
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
