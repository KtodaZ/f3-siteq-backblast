CREATE TABLE "f3-siteq-backblast_accounts" (
	"userId" varchar(255) NOT NULL,
	"type" varchar(255) NOT NULL,
	"provider" varchar(255) NOT NULL,
	"providerAccountId" varchar(255) NOT NULL,
	"refresh_token" varchar,
	"access_token" varchar,
	"expires_at" integer,
	"token_type" varchar(255),
	"scope" varchar(255),
	"id_token" varchar,
	"session_state" varchar(255)
);
--> statement-breakpoint
CREATE TABLE "f3-siteq-backblast_sessions" (
	"sessionToken" varchar(255) PRIMARY KEY NOT NULL,
	"userId" varchar(255) NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "f3-siteq-backblast_verificationTokens" (
	"identifier" varchar(255) NOT NULL,
	"token" varchar(255) NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_accounts" ADD CONSTRAINT "f3-siteq-backblast_accounts_userId_f3-siteq-backblast_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."f3-siteq-backblast_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "f3-siteq-backblast_sessions" ADD CONSTRAINT "f3-siteq-backblast_sessions_userId_f3-siteq-backblast_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."f3-siteq-backblast_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "f3-siteq-backblast_accounts" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "verificationToken_token_idx" ON "f3-siteq-backblast_verificationTokens" USING btree ("token");