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
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let mounted = true;

		const generatePreview = async () => {
			if (!canvasRef.current || !imageUrl || !boundingBox) {
				setError("Missing required data");
				setIsLoading(false);
				return;
			}

			try {
				setIsLoading(true);
				setError(null);

				// Create image element (presigned URLs work fine with regular img elements)
				const img = new Image();

				img.onload = () => {
					if (!mounted || !canvasRef.current) return;

					const canvas = canvasRef.current;
					const ctx = canvas.getContext("2d");
					if (!ctx) {
						setError("Canvas not supported");
						setIsLoading(false);
						return;
					}

					// Set canvas size
					canvas.width = size;
					canvas.height = size;

					// Calculate source rectangle from bounding box
					const sourceX = boundingBox.left * img.width;
					const sourceY = boundingBox.top * img.height;
					const sourceWidth = boundingBox.width * img.width;
					const sourceHeight = boundingBox.height * img.height;


					// Clear canvas
					ctx.clearRect(0, 0, size, size);

					// Calculate dimensions to maintain aspect ratio
					const aspectRatio = sourceWidth / sourceHeight;
					let destWidth = size;
					let destHeight = size;
					let destX = 0;
					let destY = 0;

					if (aspectRatio > 1) {
						// Wider than tall
						destHeight = size / aspectRatio;
						destY = (size - destHeight) / 2;
					} else {
						// Taller than wide
						destWidth = size * aspectRatio;
						destX = (size - destWidth) / 2;
					}


					// Draw the cropped face
					ctx.drawImage(
						img,
						sourceX,
						sourceY,
						sourceWidth,
						sourceHeight,
						destX,
						destY,
						destWidth,
						destHeight
					);

					// Convert canvas to data URL (more reliable than blob)
					try {
						const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
						
						if (dataUrl && dataUrl.startsWith("data:image")) {
							setPreviewUrl(dataUrl);
							setIsLoading(false);
						} else {
							throw new Error("Invalid data URL generated");
						}
					} catch (error) {
						setError("Failed to generate preview");
						setIsLoading(false);
					}
				};

				img.onerror = (error) => {
					if (!mounted) return;
					setError("Failed to load image");
					setIsLoading(false);
				};

				// Load the image
				img.src = imageUrl;
			} catch (err) {
				if (!mounted) return;
				setError("Failed to generate preview");
				setIsLoading(false);
			}
		};

		generatePreview();

		return () => {
			mounted = false;
			// Cleanup blob URL (only if it's a blob URL, not data URL)
			if (previewUrl && previewUrl.startsWith("blob:")) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [imageUrl, boundingBox, size]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (previewUrl && previewUrl.startsWith("blob:")) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	if (isLoading) {
		return (
			<div
				className={`flex items-center justify-center bg-gray-200 rounded ${className}`}
				style={{ width: size, height: size }}
			>
				<div className="h-4 w-4 animate-spin rounded-full border-gray-400 border-b-2"></div>
			</div>
		);
	}

	if (error || !previewUrl) {
		return (
			<div
				className={`flex items-center justify-center bg-gray-200 rounded text-gray-500 text-xs ${className}`}
				style={{ width: size, height: size }}
				title={error || "Preview unavailable"}
			>
				👤
			</div>
		);
	}

	return (
		<>
			<canvas
				ref={canvasRef}
				style={{ display: "none" }}
			/>
			<img
				src={previewUrl}
				alt={alt}
				className={`rounded object-cover ${className}`}
				style={{ width: size, height: size }}
			/>
		</>
	);
}