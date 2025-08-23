"use client";

import { useEffect, useRef, useState } from "react";

interface BoundingBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface FacePreviewProps {
	imageUrl: string;
	boundingBox: BoundingBox;
	size?: number;
	className?: string;
	alt?: string;
}

export default function FacePreview({
	imageUrl,
	boundingBox,
	size = 64,
	className = "",
	alt = "Face preview",
}: FacePreviewProps) {
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;

		const generatePreview = async () => {
			if (!mounted) return;

			if (
				!imageUrl ||
				!boundingBox ||
				boundingBox.width <= 0 ||
				boundingBox.height <= 0
			) {
				setError("Invalid data");
				setIsLoading(false);
				return;
			}

			try {
				setIsLoading(true);
				setError(null);

				let fetchUrl: string;

				// Check if imageUrl is already an image proxy URL
				if (imageUrl.startsWith("/api/image-proxy")) {
					// Use the proxy URL directly
					fetchUrl = imageUrl;
				} else {
					// Extract S3 key from presigned URL and use proxy endpoint
					const url = new URL(imageUrl);
					const s3Key = url.pathname.substring(1); // Remove leading slash
					fetchUrl = `/api/image-proxy?key=${encodeURIComponent(s3Key)}`;
				}

				// Fetch image through proxy to avoid CORS issues
				const response = await fetch(fetchUrl);
				if (!response.ok) {
					throw new Error(`Failed to fetch image: ${response.status}`);
				}

				const blob = await response.blob();
				const bitmap = await createImageBitmap(blob);

				// Create canvas dynamically
				const canvas = document.createElement("canvas");
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					throw new Error("Canvas not supported");
				}

				// Set canvas size
				canvas.width = size;
				canvas.height = size;

				// Calculate source rectangle from bounding box with padding
				const padding = 0.3; // 30% padding around the face
				const expandedWidth = boundingBox.width * (1 + padding * 2);
				const expandedHeight = boundingBox.height * (1 + padding * 2);
				const expandedLeft = Math.max(
					0,
					boundingBox.left - boundingBox.width * padding,
				);
				const expandedTop = Math.max(
					0,
					boundingBox.top - boundingBox.height * padding,
				);

				// Ensure we don't go beyond image boundaries
				const maxWidth = Math.min(expandedWidth, 1 - expandedLeft);
				const maxHeight = Math.min(expandedHeight, 1 - expandedTop);

				const sourceX = expandedLeft * bitmap.width;
				const sourceY = expandedTop * bitmap.height;
				const sourceWidth = maxWidth * bitmap.width;
				const sourceHeight = maxHeight * bitmap.height;

				// Calculate destination to maintain aspect ratio
				const aspectRatio = sourceWidth / sourceHeight;
				let destWidth = size;
				let destHeight = size;
				let destX = 0;
				let destY = 0;

				if (aspectRatio > 1) {
					destHeight = size / aspectRatio;
					destY = (size - destHeight) / 2;
				} else {
					destWidth = size * aspectRatio;
					destX = (size - destWidth) / 2;
				}

				// Draw the cropped face
				ctx.drawImage(
					bitmap,
					sourceX,
					sourceY,
					sourceWidth,
					sourceHeight,
					destX,
					destY,
					destWidth,
					destHeight,
				);

				// Convert to data URL
				const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

				if (mounted) {
					setPreviewUrl(dataUrl);
					setIsLoading(false);
				}

				// Cleanup
				bitmap.close();
			} catch (error) {
				if (mounted) {
					console.error("FacePreview generation failed:", error);
					setError("Failed to load");
					setIsLoading(false);
				}
			}
		};

		generatePreview();

		return () => {
			mounted = false;
		};
	}, [imageUrl, boundingBox, size]);

	if (isLoading) {
		return (
			<div
				className={`flex items-center justify-center rounded bg-gray-200 ${className}`}
				style={{ width: size, height: size }}
			>
				<div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
			</div>
		);
	}

	if (error || !previewUrl) {
		return (
			<div
				className={`flex items-center justify-center rounded bg-gray-200 text-gray-500 ${className}`}
				style={{ width: size, height: size }}
				title={error || "Preview unavailable"}
			>
				👤
			</div>
		);
	}

	return (
		<img
			src={previewUrl}
			alt={alt}
			className={`rounded object-cover ${className}`}
			style={{ width: size, height: size }}
		/>
	);
}
