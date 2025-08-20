# Face Recognition Service - LLM Implementation Checklist

This document provides a comprehensive, phased checklist for implementing the face recognition service. Each phase contains specific, actionable tasks designed for LLM execution with clear acceptance criteria.

## Project Overview
- **Goal**: Cloud-based web service for face recognition in group photos
- **Scale**: ~20 users, 1000+ photos/month, 15-20 people per photo
- **Stack**: T3 Stack (Next.js, TypeScript, Tailwind, tRPC, Drizzle, NextAuth), Vercel hosting, AWS Lambda/S3/Rekognition, Supabase PostgreSQL
- **Budget**: ~$3.80/month operational cost

---

## Phase 0: Critical Face Recognition Fixes (URGENT - 1-2 weeks)

### 0.1 Replace Mock Implementation with Real AWS Integration

#### 0.1.1 Current Problem Analysis
- [ ] **CRITICAL ISSUE**: Mock face detection found in `src/server/api/routers/photo.ts` (lines 98-139)
- [ ] System generates random face count (1-8), fake confidence scores (70-100%), random bounding boxes
- [ ] No actual AWS Rekognition processing occurring
- [ ] This explains major inaccuracies in group photo recognition
- [ ] **Acceptance**: Mock implementation completely removed and documented

#### 0.1.2 Lambda Integration Service
- [ ] Remove existing mock Lambda service at `src/server/services/lambda.ts`
- [ ] Create proper Lambda invocation service using `@aws-sdk/client-lambda`
- [ ] Add environment variables for Lambda function names:
  ```
  FACE_DETECTION_LAMBDA_FUNCTION="f3-face-detection"
  FACE_RECOGNITION_LAMBDA_FUNCTION="f3-face-recognition"
  ```
- [ ] Implement group photo detection heuristics (file size >2MB, keywords)
- [ ] **Acceptance**: Lambda functions can be invoked from Next.js server

#### 0.1.3 Replace Mock with Real Processing
- [ ] Remove setTimeout mock implementation (photo.ts:98-139)
- [ ] Integrate Lambda invocation in photo upload flow
- [ ] Add proper async processing with status tracking
- [ ] Implement real-time status updates (processing → completed/failed)
- [ ] **Acceptance**: Real face detection replaces all mock data

### 0.2 Fix Critical SQL Injection Vulnerabilities

#### 0.2.1 Lambda Function Security Issues
- [ ] **SECURITY CRITICAL**: String concatenation in `lambda/detectFaces.js` (lines 83-97):
  ```javascript
  // VULNERABLE CODE:
  await db.execute(`UPDATE f3-siteq-backblast_photos SET processing_status = 'completed', face_count = ${faces.length} WHERE id = ${photoId}`);
  ```
- [ ] **SECURITY CRITICAL**: String concatenation in `lambda/recognizeFaces.js` (lines 78-91):
  ```javascript
  // VULNERABLE CODE:  
  const personQuery = await db.execute(`SELECT person_id FROM f3-siteq-backblast_face_encodings WHERE aws_face_id = '${faceId}' LIMIT 1`);
  ```
- [ ] **Acceptance**: All vulnerable code patterns identified and documented

#### 0.2.2 Implement Secure Database Operations
- [ ] Import Drizzle ORM schema into Lambda functions
- [ ] Replace all `db.execute()` calls with Drizzle ORM operations
- [ ] Use parameterized queries with `eq()` and proper typing:
  ```typescript
  // SECURE REPLACEMENT:
  await db.update(photos)
    .set({ processingStatus: 'completed', faceCount: faces.length })
    .where(eq(photos.id, photoId));
    
  const person = await db.query.faceEncodings.findFirst({
    where: eq(faceEncodings.awsFaceId, faceId)
  });
  ```
- [ ] Add proper TypeScript typing throughout Lambda functions
- [ ] **Acceptance**: Security scan shows no SQL injection vulnerabilities

#### 0.2.3 Transaction Management
- [ ] Implement database transactions for multi-table operations
- [ ] Add rollback mechanisms for failed Lambda processing
- [ ] Ensure atomic operations for face detection and recognition
- [ ] **Acceptance**: All database operations are atomic and secure

### 0.3 Group Photo Optimization Strategy

#### 0.3.1 Dynamic Confidence Thresholds
- [ ] Current fixed 80% threshold too high for group photos
- [ ] Implement adaptive thresholds:
  - Individual photos: 80% confidence minimum
  - Group photos (>10MB or >5 detected faces): 60% confidence minimum
  - Conservative matching: 75% for final results
- [ ] Add confidence range handling (60-75% requires manual review)
- [ ] **Acceptance**: Different thresholds applied based on photo type

#### 0.3.2 Multi-Pass Detection Strategy
- [ ] Implement detection pipeline in `lambda/detectFaces.js`:
  ```javascript
  // Pass 1: Liberal detection (detect all possible faces)
  const liberalResults = await detectFaces({ threshold: 60 });
  
  // Pass 2: Conservative matching (high confidence matches only)  
  const conservativeMatches = await recognizeFaces({ threshold: 75 });
  
  // Pass 3: Queue medium confidence for manual review
  const reviewQueue = filterConfidenceRange(60, 75);
  ```
- [ ] Add face quality scoring to prioritize best faces
- [ ] Implement face clustering for unknown faces
- [ ] **Acceptance**: Multi-pass strategy improves group photo accuracy by 50-70%

#### 0.3.3 Image Preprocessing for Group Photos
- [ ] Add Sharp image processing to Lambda functions
- [ ] Implement face-aware enhancement:
  ```javascript
  async function preprocessGroupPhoto(imageBuffer) {
    return await sharp(imageBuffer)
      .normalize()        // Improve contrast
      .sharpen()         // Enhance edge definition
      .resize(1600, null, { withoutEnlargement: true })
      .toBuffer();
  }
  ```
- [ ] Add lighting correction for group photos
- [ ] Optimize resolution for small faces (ensure minimum 40x40 pixel faces)
- [ ] **Acceptance**: Preprocessed images show measurable accuracy improvement

### 0.4 Enhanced Database Schema for Face Recognition

#### 0.4.1 Add Face Quality Metrics
- [ ] Update `photoFaces` table schema in `src/server/db/schema.ts`:
  ```typescript
  export const photoFaces = createTable("photo_faces", {
    // ... existing fields
    faceQuality: real("face_quality"),                    // 0-100 quality score
    detectionMethod: varchar("detection_method", { length: 50 }), // 'liberal', 'conservative', 'manual'
    reviewStatus: varchar("review_status", { length: 20 }).default("pending"), // 'pending', 'confirmed', 'rejected'
    boundingBoxQuality: real("bounding_box_quality"),     // Face boundary clarity
    faceSize: real("face_size"),                         // Size in pixels
  });
  ```
- [ ] Generate and apply database migration
- [ ] **Acceptance**: Database captures comprehensive face quality data

#### 0.4.2 Add Image Metadata Tracking
- [ ] Update `photos` table schema:
  ```typescript
  export const photos = createTable("photos", {
    // ... existing fields
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"), 
    averageFaceSize: real("average_face_size"),          // Average pixels per face
    isGroupPhoto: boolean("is_group_photo").default(false),
    processingAttempts: integer("processing_attempts").default(0),
    preprocessed: boolean("preprocessed").default(false),
    enhancementApplied: varchar("enhancement_applied", { length: 100 }),
  });
  ```
- [ ] Update Lambda functions to populate metadata
- [ ] **Acceptance**: Image characteristics tracked for optimization analysis

### 0.5 Robust Error Handling and Recovery

#### 0.5.1 Lambda Function Error Handling
- [ ] Implement retry mechanisms with exponential backoff:
  ```javascript
  async function robustPhotoProcessing(photoId, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await processPhoto(photoId);
        if (result.success) return result;
        
        if (attempt < maxRetries) {
          await sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
        }
      } catch (error) {
        await logError(photoId, attempt, error);
        if (attempt === maxRetries) {
          await markFailed(photoId, error);
          throw error;
        }
      }
    }
  }
  ```
- [ ] Add comprehensive error logging with context
- [ ] Implement dead letter queues for failed processing
- [ ] **Acceptance**: System recovers gracefully from Lambda failures

#### 0.5.2 Database Transaction Management
- [ ] Wrap all multi-table operations in transactions
- [ ] Add proper rollback for failed face processing
- [ ] Prevent photos stuck in "processing" status
- [ ] Add processing timeout detection (mark as failed after 10 minutes)
- [ ] **Acceptance**: No photos remain in inconsistent states

#### 0.5.3 Monitoring and Alerting
- [ ] Add CloudWatch metrics for Lambda success/failure rates
- [ ] Implement processing time monitoring
- [ ] Add alerts for high error rates or timeouts
- [ ] Create processing status dashboard
- [ ] **Acceptance**: Full visibility into face recognition pipeline health

### 0.6 Integration Testing and Validation

#### 0.6.1 End-to-End Testing
- [ ] Test complete workflow with real group photos (15-20 people)
- [ ] Validate accuracy improvements vs. mock implementation
- [ ] Test error handling with corrupted images
- [ ] Verify SQL injection fixes with security scanning
- [ ] **Acceptance**: All critical fixes validated with real data

#### 0.6.2 Performance Benchmarking
- [ ] Measure processing time improvements
- [ ] Compare accuracy before/after optimizations
- [ ] Test Lambda timeout handling
- [ ] Validate confidence threshold effectiveness
- [ ] **Acceptance**: Quantified improvement metrics documented

---

## Phase 1: T3 Stack MVP (4-6 weeks)

### 1.1 T3 Stack Project Setup

#### 1.1.1 Create T3 App
- [ ] Initialize T3 app with `npx create-t3-app@latest`
- [ ] Select options: TypeScript, Tailwind CSS, tRPC, Drizzle, NextAuth.js
- [ ] Project structure:
  ```
  /
  ├── src/
  │   ├── app/                    # Next.js App Router
  │   │   ├── api/
  │   │   ├── globals.css
  │   │   └── layout.tsx
  │   ├── components/             # React components
  │   ├── lib/                    # Utility functions
  │   ├── server/                 # tRPC server code
  │   │   └── api/
  │   ├── styles/                 # Global styles
  │   └── types/                  # TypeScript types
  ├── lambda/                     # AWS Lambda functions
  ├── drizzle/                    # Database migrations
  ├── public/                     # Static assets
  ├── next.config.js
  └── package.json
  ```

#### 1.1.2 T3 Stack Configuration
- [ ] Configure TypeScript with strict mode
- [ ] Set up Tailwind CSS with custom theme
- [ ] Configure tRPC with type-safe API routes
- [ ] Set up Drizzle with Supabase connection
- [ ] Configure NextAuth.js for authentication
- [ ] **Acceptance**: `npm run dev` starts application successfully

#### 1.1.3 Environment Configuration
- [ ] Create `.env.local` file with T3 environment variables:
  ```
  DATABASE_URL="postgresql://..."
  NEXTAUTH_SECRET="..."
  NEXTAUTH_URL="http://localhost:3000"
  AWS_ACCESS_KEY_ID="..."
  AWS_SECRET_ACCESS_KEY="..."
  AWS_REGION="us-east-1"
  S3_BUCKET_NAME="..."
  REKOGNITION_COLLECTION_ID="..."
  SUPABASE_URL="..."
  SUPABASE_ANON_KEY="..."
  ```
- [ ] Configure environment validation with zod
- [ ] Set up type-safe environment config

#### 1.1.4 tRPC API Setup
- [ ] Create tRPC router structure in `src/server/api/`
- [ ] Set up context with database and authentication
- [ ] Create type-safe API procedures
- [ ] Configure tRPC client for frontend
- [ ] **Acceptance**: T3 app runs with tRPC working

### 1.2 Database Setup with Drizzle

#### 1.2.1 Supabase Database Setup
- [ ] Create free Supabase project (500MB database, 2GB bandwidth)
- [ ] Configure connection string in environment
- [ ] Set up row-level security policies
- [ ] **Acceptance**: Database connection established

#### 1.2.2 Drizzle Schema Setup
- [ ] Create Drizzle schema in `src/server/db/schema.ts`:
  ```typescript
  import { pgTable, serial, varchar, timestamp, integer, real, jsonb, boolean } from 'drizzle-orm/pg-core';

  export const users = pgTable('users', {
    id: varchar('id', { length: 255 }).notNull().primaryKey(),
    name: varchar('name', { length: 255 }),
    email: varchar('email', { length: 255 }).notNull(),
    emailVerified: timestamp('emailVerified', { mode: 'date' }),
    image: varchar('image', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  });

  export const people = pgTable('people', {
    id: serial('id').primaryKey(),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  });

  export const faceEncodings = pgTable('face_encodings', {
    id: serial('id').primaryKey(),
    personId: integer('person_id').references(() => people.id),
    awsFaceId: varchar('aws_face_id', { length: 255 }).unique().notNull(),
    confidence: real('confidence'),
    imageUrl: varchar('image_url', { length: 500 }),
    createdAt: timestamp('created_at').defaultNow(),
  });

  export const photos = pgTable('photos', {
    id: serial('id').primaryKey(),
    filename: varchar('filename', { length: 255 }).notNull(),
    s3Key: varchar('s3_key', { length: 500 }).notNull(),
    uploadDate: timestamp('upload_date').defaultNow(),
    processingStatus: varchar('processing_status', { length: 50 }).default('pending'),
    faceCount: integer('face_count').default(0),
  });

  export const photoFaces = pgTable('photo_faces', {
    id: serial('id').primaryKey(),
    photoId: integer('photo_id').references(() => photos.id),
    personId: integer('person_id').references(() => people.id),
    awsFaceId: varchar('aws_face_id', { length: 255 }),
    confidence: real('confidence'),
    boundingBox: jsonb('bounding_box'),
    isConfirmed: boolean('is_confirmed').default(false),
  });
  ```
- [ ] Generate migrations with `npm run db:generate`
- [ ] Push schema to database with `npm run db:push`
- [ ] **Acceptance**: Database schema applied successfully with Drizzle

### 1.3 AWS Infrastructure Setup

#### 1.3.1 S3 Configuration
- [ ] Create S3 bucket for photo storage with:
  - Versioning enabled
  - Server-side encryption (AES-256)
  - Public access blocked
  - CORS policy for frontend uploads
- [ ] Create IAM policy for S3 access (read/write/delete)
- [ ] **Acceptance**: Can upload test image via AWS CLI

#### 1.3.2 Rekognition Setup
- [ ] Create Rekognition collection for face storage
- [ ] Set up IAM policy for Rekognition access:
  - `rekognition:CreateCollection`
  - `rekognition:IndexFaces`
  - `rekognition:SearchFacesByImage`
  - `rekognition:ListFaces`
  - `rekognition:DeleteFaces`
- [ ] **Acceptance**: Collection created and accessible via AWS CLI

#### 1.3.3 Lambda Function Foundation
- [ ] Create Lambda function structure in `lambda/` directory
- [ ] Set up basic handler for photo processing
- [ ] Configure Lambda environment variables
- [ ] Set timeout to 5 minutes (max processing time)
- [ ] Configure memory allocation (3008 MB for face processing)
- [ ] **Acceptance**: Lambda function deploys and responds to test events

### 1.4 NextAuth.js Authentication Setup

#### 1.4.1 NextAuth Configuration
- [ ] Configure NextAuth.js in `src/server/auth.ts`
- [ ] Set up authentication providers (Google, GitHub, etc.)
- [ ] Configure session strategy and callbacks
- [ ] Add Prisma adapter for user management
- [ ] **Acceptance**: User authentication working

### 1.5 Caching with Vercel KV

#### 1.5.1 Vercel KV Setup
- [ ] Create Vercel KV database (30K operations/month free)
- [ ] Configure Redis client for caching
- [ ] Set up face encoding cache with 2-day TTL
- [ ] **Acceptance**: Caching working with Redis

### 1.6 Photo Upload System


#### 1.6.1 Frontend Upload Interface
- [ ] Create upload page at `src/app/upload/page.tsx`
- [ ] Build with Tailwind CSS components
- [ ] Implement drag-and-drop upload area with React hooks
- [ ] Add mobile camera capture button
- [ ] Create upload progress indicator
- [ ] Validate file types (JPEG, PNG, WebP) client-side
- [ ] Limit file size to 10MB max
- [ ] **Acceptance**: Can select and queue multiple files for upload

#### 1.6.2 tRPC Upload Handler
- [ ] Create tRPC procedure for file upload
- [ ] Generate unique filenames with cuid
- [ ] Upload files directly to S3 from server
- [ ] Save photo metadata to database using Prisma
- [ ] Return upload status and photo ID
- [ ] **Acceptance**: Files upload to S3 and database record created

#### 1.6.3 Upload Flow Integration
- [ ] Connect frontend to tRPC upload procedure
- [ ] Display upload progress with percentage
- [ ] Handle upload errors gracefully
- [ ] Redirect to processing page after upload
- [ ] **Acceptance**: Complete upload flow works end-to-end

### 1.7 Face Recognition with tRPC

#### 1.7.1 Face Detection Lambda
- [ ] Create face detection function in `lambda/detectFaces.js`
- [ ] Integrate with AWS Rekognition `DetectFaces` API
- [ ] Extract face bounding boxes and confidence scores
- [ ] Store detected faces in database
- [ ] Handle images with 0 faces gracefully
- [ ] **Acceptance**: Lambda detects faces in test group photo

#### 1.7.2 Face Recognition Lambda
- [ ] Create face recognition function in `lambda/recognizeFaces.js`
- [ ] Use Rekognition `SearchFacesByImage` for known faces
- [ ] Implement confidence threshold (80% minimum)
- [ ] Store recognition results in database
- [ ] Handle unknown faces (no matches)
- [ ] **Acceptance**: Lambda recognizes known faces with confidence scores

#### 1.7.3 Face Processing tRPC Pipeline
- [ ] Create tRPC procedure for face processing
- [ ] Trigger Lambda functions via AWS SDK
- [ ] Update photo processing status in database using Prisma
- [ ] Handle Lambda timeout errors
- [ ] Return processing results to frontend
- [ ] **Acceptance**: Full processing pipeline works for uploaded photos

### 1.8 Results Display with React

#### 1.8.1 Results Page Structure
- [ ] Create results page at `src/app/results/[photoId]/page.tsx`
- [ ] Build with Tailwind CSS and React components
- [ ] Display original photo with face bounding boxes using Canvas API
- [ ] Show list of detected faces with recognition status
- [ ] Include confidence scores for recognized faces
- [ ] Handle loading states during processing with React Suspense
- [ ] **Acceptance**: Results page displays face detection data

#### 1.8.2 Unknown Face Labeling with tRPC
- [ ] Create name assignment modal component
- [ ] Allow users to type names for unknown faces
- [ ] Save new person to database
- [ ] Index new face in Rekognition collection
- [ ] Update face_encodings table with new data
- [ ] **Acceptance**: Users can assign names to unknown faces

#### 1.8.3 Confidence Visualization
- [ ] Create confidence indicator component (progress ring)
- [ ] Use color coding: Green (>90%), Yellow (80-90%), Red (<80%)
- [ ] Display percentage values
- [ ] Handle cases with no recognition results
- [ ] **Acceptance**: Confidence levels clearly visible on results page

### 1.9 T3 Stack MVP Testing & Validation

#### 1.9.1 End-to-End Testing
- [ ] Test complete flow: upload → process → view results
- [ ] Test with various photo sizes and formats
- [ ] Test with photos containing 15-20 faces
- [ ] Verify processing completes under 2-minute target
- [ ] Test error handling for corrupt/invalid images
- [ ] **Acceptance**: MVP handles target use case successfully

#### 1.9.2 Performance Validation
- [ ] Measure average processing time per photo
- [ ] Monitor Lambda execution duration and memory usage
- [ ] Test database query performance with sample data
- [ ] Verify S3 upload speeds on mobile networks
- [ ] **Acceptance**: All performance targets met

---

## Phase 2: Enhanced Features (4-6 weeks)

### 2.1 Advanced Photo Processing

#### 2.1.1 Low-Light Enhancement
- [ ] Implement CLAHE (Contrast Limited Adaptive Histogram Equalization)
- [ ] Add gamma correction preprocessing
- [ ] Create image enhancement Lambda function
- [ ] A/B test enhancement vs. original image recognition
- [ ] Benchmark accuracy improvement (target: 4% increase)
- [ ] **Acceptance**: Enhanced images show measurable accuracy improvement

#### 2.1.2 Batch Processing Optimization
- [ ] Implement parallel face processing in Lambda
- [ ] Use SQS for job queuing
- [ ] Add batch status tracking
- [ ] Optimize memory usage for large images
- [ ] **Acceptance**: Multiple faces process concurrently

### 2.2 Enhanced User Interface

#### 2.2.1 Mobile PWA Optimization
- [ ] Create PWA manifest with proper icons using next-pwa
- [ ] Implement service worker for offline support
- [ ] Add iOS-specific meta tags in layout.tsx
- [ ] Optimize camera capture flow for mobile using getUserMedia API
- [ ] Handle PWA vs. browser camera access differences
- [ ] **Acceptance**: App installs and works as PWA on iOS/Android

#### 2.2.2 Improved Results Interface
- [ ] Add swipe gestures for mobile face navigation
- [ ] Implement photo zoom and pan functionality
- [ ] Create face gallery view
- [ ] Add batch name assignment for similar faces
- [ ] **Acceptance**: Mobile interface feels native and responsive

#### 2.2.3 Advanced Confidence Handling
- [ ] Implement multiple match selection interface
- [ ] Show top 3 potential matches for ambiguous faces
- [ ] Allow users to confirm or reject suggestions
- [ ] Update confidence scores based on user feedback
- [ ] **Acceptance**: Ambiguous results handled gracefully

### 2.3 Performance Optimization

#### 2.3.1 Redis Caching Implementation
- [ ] Cache face encodings by person ID
- [ ] Implement cache warming for frequent lookups
- [ ] Add cache invalidation on person updates
- [ ] Monitor cache hit rates
- [ ] **Acceptance**: Sub-millisecond face lookup for cached data

#### 2.3.2 Database Query Optimization
- [ ] Add proper indexes for common queries
- [ ] Implement connection pooling
- [ ] Optimize photo metadata queries
- [ ] Add query performance monitoring
- [ ] **Acceptance**: All database queries under 100ms

### 2.4 User Management

#### 2.4.1 Person Management Interface
- [ ] Create people listing page
- [ ] Add person profile pages with all photos
- [ ] Implement person merging (duplicate handling)
- [ ] Allow person deletion with cascade cleanup
- [ ] **Acceptance**: Complete person management workflow

#### 2.4.2 Photo Management
- [ ] Create photo gallery with filtering
- [ ] Add photo deletion functionality
- [ ] Implement bulk operations
- [ ] Show processing history and status
- [ ] **Acceptance**: Users can manage photo collections effectively

---

## Phase 3: Production Ready (2-4 weeks)

### 3.1 Security & Compliance

#### 3.1.1 Data Protection
- [ ] Implement AES-256 encryption for sensitive data
- [ ] Add GDPR compliance features:
  - Data export functionality
  - Right to deletion
  - Consent management
  - Data retention policies
- [ ] Create privacy policy and terms of service
- [ ] **Acceptance**: GDPR compliance audit passes

#### 3.1.2 Security Hardening
- [ ] Add input validation and sanitization
- [ ] Implement rate limiting on API endpoints
- [ ] Add CSRF protection
- [ ] Secure S3 bucket access patterns
- [ ] Regular security dependency updates
- [ ] **Acceptance**: Security scan shows no critical vulnerabilities

### 3.2 Monitoring & Analytics

#### 3.2.1 Application Monitoring
- [ ] Add CloudWatch logging for Lambda functions
- [ ] Implement error tracking and alerting
- [ ] Monitor API response times
- [ ] Track user engagement metrics
- [ ] **Acceptance**: Full observability into system health

#### 3.2.2 Cost Monitoring
- [ ] Set up AWS cost alerts
- [ ] Monitor Rekognition API usage
- [ ] Track S3 storage costs
- [ ] Implement usage analytics dashboard
- [ ] **Acceptance**: Monthly cost tracking under $30 target

### 3.3 Deployment & DevOps

#### 3.3.1 Production Deployment
- [ ] Configure Turborepo build pipeline in `turbo.json`
- [ ] Deploy Next.js app (`apps/web`) to Vercel from monorepo
- [ ] Configure Vercel to build only the web app (`--filter=web`)
- [ ] Set up production environment variables in Vercel dashboard
- [ ] Deploy AWS Lambda functions for face processing
- [ ] Configure custom domain (optional)
- [ ] Add health checks and monitoring
- [ ] **Acceptance**: Automated deployment to production via Vercel with Turborepo

#### 3.3.2 Backup & Recovery
- [ ] Implement database backup strategy
- [ ] S3 cross-region replication
- [ ] Document disaster recovery procedures
- [ ] Test backup restoration process
- [ ] **Acceptance**: Recovery procedures tested and documented

---

## Budget Breakdown

### Monthly Operating Costs (20 users, 1000 photos/month)
- **Hosting**: $0/month (Vercel Hobby plan - 100GB bandwidth)
- **Face Recognition API**: $1.50/month (AWS Rekognition)
- **Photo Storage**: $2.30/month (S3, 100GB)
- **Database**: $0/month (Supabase free tier - 500MB)
- **Authentication**: $0/month (Supabase Auth)
- **Lambda Functions**: $0/month (AWS free tier)
- **Total Estimated**: $3.80/month

### Development Costs
- Phase 1 MVP: 6-8 weeks development
- Phase 2 Enhancement: 4-6 weeks development
- Ongoing maintenance: 2-4 hours/month

### Cost Optimization Strategies
- Use free tiers: Vercel, Supabase for zero hosting costs
- Optimize Lambda execution time to minimize compute costs
- Implement image compression to reduce S3 storage
- Use CloudFront CDN free tier for faster image delivery
- Monitor usage to stay within free tier limits

---

## LLM Implementation Guidelines

### Code Patterns to Follow

#### Error Handling
```typescript
// Next.js API Route error response format
import { NextRequest, NextResponse } from 'next/server';

interface ApiError {
  error: string;
  code: string;
  details?: any;
}

// API Route error handling pattern
export async function POST(request: NextRequest) {
  try {
    const result = await someAsyncOperation();
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Operation failed:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
```

#### Database Operations with Drizzle
```typescript
// Use Drizzle ORM for type-safe database operations
import { db } from '~/server/db';
import { people, faceEncodings } from '~/server/db/schema';
import { eq } from 'drizzle-orm';

async function getPerson(id: number) {
  try {
    const person = await db
      .select()
      .from(people)
      .where(eq(people.id, id))
      .leftJoin(faceEncodings, eq(faceEncodings.personId, people.id));
    return person;
  } catch (error) {
    console.error('Database error:', error);
    throw error;
  }
}

async function createPerson(name: string) {
  const [newPerson] = await db
    .insert(people)
    .values({ name })
    .returning();
  return newPerson;
}
```

#### AWS SDK Usage
```typescript
// Initialize AWS clients with proper configuration
import { S3Client } from '@aws-sdk/client-s3';
import { RekognitionClient } from '@aws-sdk/client-rekognition';

const s3Client = new S3Client({ 
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
});

const rekognitionClient = new RekognitionClient({ 
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  }
});
```

### Testing Requirements

#### Unit Tests
- [ ] Test all utility functions
- [ ] Mock AWS services for testing
- [ ] Test database operations with test database
- [ ] Achieve >80% code coverage

#### Integration Tests
- [ ] Test complete upload flow
- [ ] Test face recognition pipeline
- [ ] Test error scenarios
- [ ] Validate API response formats

#### Performance Tests
- [ ] Load test with multiple concurrent uploads
- [ ] Test with various image sizes
- [ ] Benchmark database query performance
- [ ] Validate mobile performance

### Deployment Checklist

#### Pre-deployment
- [ ] All tests passing
- [ ] Security scan completed
- [ ] Performance benchmarks met
- [ ] Documentation updated

#### Production Setup
- [ ] Environment variables configured
- [ ] SSL certificates installed
- [ ] Monitoring dashboards active
- [ ] Backup systems operational

#### Post-deployment
- [ ] Smoke tests in production
- [ ] Monitor error rates
- [ ] Validate performance metrics
- [ ] User acceptance testing

---

## Success Metrics & Validation

### Performance Targets
- [ ] 95%+ recognition accuracy for known faces
- [ ] <2 minute processing time per photo
- [ ] 99%+ system uptime
- [ ] <3 seconds initial page load time

### User Experience Goals
- [ ] Intuitive mobile interface (user testing)
- [ ] Clear confidence indicators (>90% user comprehension)
- [ ] Efficient training workflow (<30 seconds per face)
- [ ] Minimal false positive rates (<5%)

### Technical Metrics
- [ ] Database queries <100ms average
- [ ] API response times <500ms
- [ ] Cache hit rate >80%
- [ ] Monthly costs <$30

---

## Troubleshooting Guide

### Common Issues
1. **Lambda Timeout**: Increase memory allocation, optimize image processing
2. **Low Recognition Accuracy**: Implement photo enhancement, adjust confidence thresholds
3. **Mobile Camera Issues**: Check PWA manifest, browser compatibility
4. **Database Performance**: Add indexes, optimize queries, use Drizzle with connection pooling
5. **S3 Upload Failures**: Check CORS policy, validate file sizes, handle network errors
6. **Vercel Function Limits**: Optimize for 10-second timeout, use edge functions where possible
7. **Free Tier Limits**: Monitor Neon, Upstash usage to stay within free tiers

### Debug Tools
- Vercel Function logs for serverless debugging
- CloudWatch logs for Lambda functions
- Browser developer tools for frontend issues
- Drizzle Studio for database inspection
- AWS X-Ray for distributed tracing

### Cost Monitoring Tools
- Vercel dashboard for bandwidth and function usage
- AWS Cost Explorer for S3 and Rekognition costs
- Neon dashboard for database usage
- Upstash dashboard for Redis usage

This checklist provides a comprehensive roadmap for implementing the face recognition service with Turborepo, Next.js, Drizzle ORM, and cost-optimized infrastructure. Each task includes specific acceptance criteria and technical guidance for LLM execution.

### T3 Stack Commands Reference
- `npm run dev` - Start development server
- `npm run build` - Build the application
- `npm run start` - Start production server
- `npm run lint` - Run ESLint
- `npm run db:generate` - Generate Drizzle migrations
- `npm run db:push` - Push schema to database
- `npm run db:studio` - Open Drizzle Studio