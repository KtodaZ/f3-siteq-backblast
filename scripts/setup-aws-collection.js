#!/usr/bin/env node

/**
 * AWS Rekognition Collection Setup Script
 * 
 * Creates the required AWS Rekognition collection for face recognition.
 * Run this script once during initial setup.
 */

import { RekognitionClient, CreateCollectionCommand, ListCollectionsCommand } from "@aws-sdk/client-rekognition";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: ".env.local" });

const collectionId = process.env.REKOGNITION_COLLECTION_ID || "f3-siteq-faces";

const rekognitionClient = new RekognitionClient({
  region: process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function setupRekognitionCollection() {
  try {
    console.log(`Setting up AWS Rekognition collection: ${collectionId}`);
    
    // Try to create the collection directly
    const createCommand = new CreateCollectionCommand({
      CollectionId: collectionId,
    });
    
    const result = await rekognitionClient.send(createCommand);
    
    console.log(`✅ Successfully created collection '${collectionId}'`);
    console.log(`Collection ARN: ${result.CollectionArn}`);
    console.log(`Status: ${result.StatusMessage}`);
    
  } catch (error) {
    if (error.name === "ResourceAlreadyExistsException") {
      console.log(`✅ Collection '${collectionId}' already exists`);
      return;
    }
    
    console.error("❌ Failed to setup Rekognition collection:", error);
    
    if (error.name === "UnauthorizedOperation" || error.name === "AccessDenied") {
      console.error("\n🔧 Possible solutions:");
      console.error("1. Check your AWS credentials are correct");
      console.error("2. Ensure your AWS user has rekognition:CreateCollection permission");
      console.error("3. Verify your AWS region is correct");
    }
    
    process.exit(1);
  }
}

// Check required environment variables
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("❌ Missing required AWS credentials:");
  console.error("Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local");
  process.exit(1);
}

setupRekognitionCollection();