# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a T3 Stack face recognition service for small organizations (~20 users) to identify people in group photos. Built using Next.js 15 with App Router, TypeScript, Tailwind CSS, tRPC, Drizzle ORM, and AWS services (S3, Rekognition, Lambda).

**Target**: Process 1000+ photos/month with 15-20 people per photo in under 2 minutes per photo.

## Development Commands

### Core Development
- `npm run dev` - Start development server with Turbo mode
- `npm run build` - Build Next.js application  
- `npm run start` - Start production server
- `npm run preview` - Build and start in preview mode
- `npm run typecheck` - Run TypeScript compiler checks

### Code Quality
- `npm run check` - Run Biome linter and formatter checks
- `npm run check:write` - Run Biome with auto-fixes
- `npm run check:unsafe` - Run Biome with unsafe auto-fixes

### Database Operations
- `npm run db:generate` - Generate Drizzle migrations from schema changes
- `npm run db:migrate` - Apply migrations to database
- `npm run db:push` - Push schema directly to database (dev only)
- `npm run db:studio` - Open Drizzle Studio for database inspection
- `./start-database.sh` - Start local PostgreSQL container

## Architecture Overview

### Core Tech Stack
- **Frontend**: Next.js 15 App Router + React 19 + TypeScript + Tailwind CSS
- **Backend**: tRPC + Drizzle ORM + PostgreSQL (Supabase)
- **Cloud Services**: AWS S3 (storage) + Rekognition (face recognition) + Lambda (processing)
- **Tooling**: Biome (linting/formatting), pnpm (package manager)

### Database Schema (schema.ts:10-72)
Face recognition system with multi-project schema using prefix `f3-siteq-backblast_`:

- `users` - Authentication (NextAuth.js compatible)
- `people` - Known individuals in the system
- `faceEncodings` - AWS Rekognition face IDs linked to people
- `photos` - Uploaded images with processing status
- `photoFaces` - Detected faces in photos with recognition results
- `posts` - Legacy table (kept for tRPC compatibility)

### Environment Configuration (env.js:4-58)
Type-safe environment validation using @t3-oss/env-nextjs:

**Server Variables:**
- `DATABASE_URL` - PostgreSQL connection
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` - AWS credentials
- `S3_BUCKET_NAME`, `REKOGNITION_COLLECTION_ID` - AWS service configuration
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` - Database connection

## Key Implementation Details

### Database Connection Pattern
- Uses connection caching in development (db/index.ts:11-16)
- Drizzle ORM with postgres-js driver
- Multi-project schema with table prefixing

### File Structure Conventions
- `src/app/` - Next.js App Router pages and API routes
- `src/server/` - tRPC server code and database layer  
- `src/components/` - Reusable React components
- `lambda/` - AWS Lambda functions for image processing

### Type Safety Approach
- End-to-end TypeScript with strict mode
- tRPC for type-safe API procedures
- Drizzle for type-safe database queries
- Zod schemas for runtime validation

## Testing and Quality

### Code Quality Tools
- **Biome**: Unified linting, formatting, and import organization
- **TypeScript**: Strict type checking with `noUncheckedIndexedAccess`
- **Custom Biome Rules**: Tailwind class sorting with `useSortedClasses`

### Test Commands
Run `npm run typecheck` before committing to ensure type safety.
Run `npm run check` to validate code style and formatting.

## Development Workflow

1. **Local Database**: Use `./start-database.sh` to start PostgreSQL container
2. **Schema Changes**: Modify `src/server/db/schema.ts` → `npm run db:generate` → `npm run db:push`
3. **API Development**: Create tRPC procedures in `src/server/api/routers/`
4. **Frontend**: Build components in `src/app/_components/` following existing patterns

## Performance Considerations

- Uses PostgreSQL connection pooling via postgres-js
- Image processing handled in AWS Lambda (not Vercel functions due to timeouts)
- Database queries optimized with proper indexing
- Face recognition caching recommended for production

## Security Notes

- Face recognition data requires GDPR compliance
- AWS credentials managed through environment variables
- S3 bucket configured with public access blocked
- All sensitive data encrypted at rest and in transit

## Claude Code Permissions

This project has very lenient permissions configured in `.claude/settings.local.json` to allow development without constant permission prompts. All standard development tools are pre-approved.

### Pre-approved Commands (no user prompt needed):
- All file operations: Read, Write, Edit, MultiEdit, Glob, Grep, LS
- All bash commands including npm, git, docker, aws cli, etc.
- Web operations: WebFetch, WebSearch
- Development tools: TodoWrite, Task, BashOutput, KillBash
- Playwright testing: All MCP Playwright commands for E2E testing
- Context7: Library documentation lookup for development assistance

### When NOT to ask for permission:
- Installing npm packages (`npm install`, `pnpm install`)
- Running build/test commands (`npm run build`, `npm test`, etc.)
- Git operations (`git add`, `git commit`, `git push`, etc.)
- Docker operations (`docker run`, `docker build`, etc.)
- AWS CLI commands for this project's resources
- File system operations within the project directory
- Database operations (`npm run db:push`, `npm run db:studio`, etc.)

### Only ask for permission when:
- Deleting files outside the project directory
- Modifying system-wide configurations
- Installing global system packages (not npm packages)
- Operations that could affect other projects or system stability