import { type NextRequest, NextResponse } from "next/server";
import { getPresignedUrl } from "~/server/services/s3";

export async function GET(request: NextRequest) {
	try {
		const { searchParams } = new URL(request.url);
		const s3Key = searchParams.get("key");

		if (!s3Key) {
			return new NextResponse("Missing s3Key parameter", { status: 400 });
		}

		// Get the image from S3
		const presignedUrl = await getPresignedUrl(s3Key, 3600);

		// Fetch the image from S3
		const response = await fetch(presignedUrl);
		if (!response.ok) {
			return new NextResponse("Failed to fetch image from S3", { status: 500 });
		}

		const imageBuffer = await response.arrayBuffer();
		const contentType = response.headers.get("content-type") || "image/jpeg";

		// Return the image with CORS headers
		return new NextResponse(imageBuffer, {
			headers: {
				"Content-Type": contentType,
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET",
				"Access-Control-Allow-Headers": "*",
				"Cache-Control": "public, max-age=3600",
			},
		});
	} catch (error) {
		console.error("Image proxy error:", error);
		return new NextResponse("Internal server error", { status: 500 });
	}
}
