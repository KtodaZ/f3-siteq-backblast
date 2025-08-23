import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { env } from "~/env";

// Initialize Lambda client
const lambdaClient = new LambdaClient({
	region: env.AWS_REGION ?? "us-east-1",
	credentials:
		env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
			? {
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				}
			: undefined,
});

export interface FaceDetectionRequest {
	photoId: number;
	s3Key: string;
	bucketName: string;
	isGroupPhoto?: boolean; // Flag to adjust detection parameters
}

export interface FaceDetectionResult {
	success: boolean;
	photoId: number;
	facesDetected: number;
	error?: string;
}

export interface FaceRecognitionRequest {
	photoId: number;
	s3Key: string;
	bucketName: string;
	collectionId: string;
	isGroupPhoto?: boolean;
}

export interface FaceRecognitionResult {
	success: boolean;
	photoId: number;
	facesRecognized: number;
	totalMatches: number;
	error?: string;
}

/**
 * Invoke face detection Lambda function
 */
export async function invokeFaceDetection(
	request: FaceDetectionRequest,
): Promise<FaceDetectionResult> {
	try {
		const payload = {
			...request,
			bucketName: request.bucketName || env.S3_BUCKET_NAME,
		};

		const command = new InvokeCommand({
			FunctionName: env.FACE_DETECTION_LAMBDA_FUNCTION || "f3-face-detection",
			Payload: JSON.stringify(payload),
		});

		const response = await lambdaClient.send(command);

		if (response.Payload) {
			const result = JSON.parse(Buffer.from(response.Payload).toString());

			if (response.StatusCode === 200 && result.body) {
				const body = JSON.parse(result.body);
				return {
					success: body.success,
					photoId: body.photoId,
					facesDetected: body.facesDetected || 0,
					error: body.error,
				};
			}
			throw new Error(
				`Lambda invocation failed: ${result.errorMessage || "Unknown error"}`,
			);
		}
		throw new Error("No response payload from Lambda");
	} catch (error) {
		console.error("Face detection Lambda error:", error);
		return {
			success: false,
			photoId: request.photoId,
			facesDetected: 0,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

/**
 * Invoke face recognition Lambda function
 */
export async function invokeFaceRecognition(
	request: FaceRecognitionRequest,
): Promise<FaceRecognitionResult> {
	try {
		const payload = {
			...request,
			bucketName: request.bucketName || env.S3_BUCKET_NAME,
			collectionId: request.collectionId || env.REKOGNITION_COLLECTION_ID,
		};

		const command = new InvokeCommand({
			FunctionName:
				env.FACE_RECOGNITION_LAMBDA_FUNCTION || "f3-face-recognition",
			Payload: JSON.stringify(payload),
		});

		const response = await lambdaClient.send(command);

		if (response.Payload) {
			const result = JSON.parse(Buffer.from(response.Payload).toString());

			if (response.StatusCode === 200 && result.body) {
				const body = JSON.parse(result.body);
				return {
					success: body.success,
					photoId: body.photoId,
					facesRecognized: body.facesRecognized || 0,
					totalMatches: body.totalMatches || 0,
					error: body.error,
				};
			}
			throw new Error(
				`Lambda invocation failed: ${result.errorMessage || "Unknown error"}`,
			);
		}
		throw new Error("No response payload from Lambda");
	} catch (error) {
		console.error("Face recognition Lambda error:", error);
		return {
			success: false,
			photoId: request.photoId,
			facesRecognized: 0,
			totalMatches: 0,
			error: error instanceof Error ? error.message : "Unknown error",
		};
	}
}

/**
 * Check if Lambda services are configured
 */
export function isLambdaConfigured(): boolean {
	return !!(
		env.AWS_ACCESS_KEY_ID &&
		env.AWS_SECRET_ACCESS_KEY &&
		env.AWS_REGION
	);
}

/**
 * Detect if photo is likely a group photo based on metadata
 */
export function isLikelyGroupPhoto(
	filename: string,
	fileSize: number,
): boolean {
	// Heuristics for group photo detection
	const groupKeywords = [
		"group",
		"team",
		"class",
		"meeting",
		"conference",
		"party",
	];
	const hasGroupKeyword = groupKeywords.some((keyword) =>
		filename.toLowerCase().includes(keyword),
	);

	// Large file size might indicate high resolution group photo
	const isLargeFile = fileSize > 2 * 1024 * 1024; // > 2MB

	return hasGroupKeyword || isLargeFile;
}
