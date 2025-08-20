ALTER TABLE "f3-siteq-backblast_photo_faces" ADD COLUMN "face_quality" real;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photo_faces" ADD COLUMN "detection_method" varchar(50);--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photo_faces" ADD COLUMN "review_status" varchar(20) DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photo_faces" ADD COLUMN "bounding_box_quality" real;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photo_faces" ADD COLUMN "face_size" real;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "image_width" integer;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "image_height" integer;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "average_face_size" real;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "processing_attempts" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "last_error" varchar(1000);--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "preprocessed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_photos" ADD COLUMN "enhancement_applied" varchar(100);