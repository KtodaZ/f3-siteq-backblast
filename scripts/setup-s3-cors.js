#!/usr/bin/env node

/**
 * Configure S3 bucket CORS policy for face preview functionality
 * This allows the browser to fetch images as blobs for canvas processing
 */

import {
	GetBucketCorsCommand,
	PutBucketCorsCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { config } from "dotenv";

// Load environment variables
config({ path: ".env.local" });

const BUCKET_NAME = process.env.S3_BUCKET_NAME;
const AWS_REGION = process.env.AWS_REGION || "us-east-1";

if (!BUCKET_NAME) {
	console.error("❌ S3_BUCKET_NAME not found in environment variables");
	process.exit(1);
}

if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
	console.error("❌ AWS credentials not found in environment variables");
	process.exit(1);
}

const s3Client = new S3Client({
	region: AWS_REGION,
	credentials: {
		accessKeyId: process.env.AWS_ACCESS_KEY_ID,
		secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
	},
});

const corsConfiguration = {
	CORSRules: [
		{
			ID: "FacePreviewCORS",
			AllowedHeaders: ["*"],
			AllowedMethods: ["GET", "HEAD"],
			AllowedOrigins: [
				"http://localhost:3000",
				"http://localhost:3001",
				"http://localhost:3002",
				"http://localhost:3003",
				"http://localhost:3004",
				"https://*.vercel.app",
				"https://*.netlify.app",
			],
			ExposeHeaders: ["ETag"],
			MaxAgeSeconds: 3000,
		},
	],
};

async function setupCORS() {
	try {
		console.log(`🔧 Configuring CORS for S3 bucket: ${BUCKET_NAME}`);

		// Check current CORS configuration
		try {
			const getCurrentCors = new GetBucketCorsCommand({ Bucket: BUCKET_NAME });
			const currentCors = await s3Client.send(getCurrentCors);
			console.log(
				"📋 Current CORS configuration:",
				JSON.stringify(currentCors.CORSRules, null, 2),
			);
		} catch (error) {
			console.log("📋 No existing CORS configuration found");
		}

		// Apply new CORS configuration
		const putCorsCommand = new PutBucketCorsCommand({
			Bucket: BUCKET_NAME,
			CORSConfiguration: corsConfiguration,
		});

		await s3Client.send(putCorsCommand);
		console.log("✅ Successfully configured CORS for S3 bucket");

		// Verify the configuration was applied
		const verifyCors = new GetBucketCorsCommand({ Bucket: BUCKET_NAME });
		const verifyResult = await s3Client.send(verifyCors);
		console.log(
			"🔍 Verified CORS configuration:",
			JSON.stringify(verifyResult.CORSRules, null, 2),
		);
	} catch (error) {
		console.error("❌ Failed to configure CORS:", error);
		process.exit(1);
	}
}

setupCORS();
