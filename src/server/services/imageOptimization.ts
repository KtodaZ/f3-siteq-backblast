import sharp from "sharp";

export interface ImageDimensions {
	width: number;
	height: number;
}

export interface OptimizedImageResult {
	buffer: Buffer;
	dimensions: ImageDimensions;
	contentType: string;
	size: number;
}

/**
 * Image size presets for different use cases
 */
export const IMAGE_SIZES = {
	thumbnail: { width: 200, height: 200 },
	medium: { width: 800, height: 600 },
	large: { width: 1600, height: 1200 },
} as const;

/**
 * Optimize and resize an image
 */
export async function optimizeImage(
	buffer: Buffer,
	options: {
		width?: number;
		height?: number;
		quality?: number;
		format?: "jpeg" | "png" | "webp";
	} = {},
): Promise<OptimizedImageResult> {
	const { width, height, quality = 85, format = "jpeg" } = options;

	try {
		let processor = sharp(buffer);

		// Resize if dimensions provided
		if (width || height) {
			processor = processor.resize(width, height, {
				fit: "inside",
				withoutEnlargement: true,
			});
		}

		// Apply format and quality
		switch (format) {
			case "jpeg":
				processor = processor.jpeg({ quality });
				break;
			case "png":
				processor = processor.png({ quality });
				break;
			case "webp":
				processor = processor.webp({ quality });
				break;
		}

		const optimizedBuffer = await processor.toBuffer();
		const metadata = await sharp(optimizedBuffer).metadata();

		return {
			buffer: optimizedBuffer,
			dimensions: {
				width: metadata.width || 0,
				height: metadata.height || 0,
			},
			contentType: `image/${format}`,
			size: optimizedBuffer.length,
		};
	} catch (error) {
		throw new Error(
			`Image optimization failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Create multiple optimized versions of an image
 */
export async function createImageVariants(
	buffer: Buffer,
	format: "jpeg" | "png" | "webp" = "jpeg",
): Promise<Record<string, OptimizedImageResult>> {
	const variants: Record<string, OptimizedImageResult> = {};

	// Create thumbnail
	variants.thumbnail = await optimizeImage(buffer, {
		width: IMAGE_SIZES.thumbnail.width,
		height: IMAGE_SIZES.thumbnail.height,
		quality: 80,
		format,
	});

	// Create medium version
	variants.medium = await optimizeImage(buffer, {
		width: IMAGE_SIZES.medium.width,
		height: IMAGE_SIZES.medium.height,
		quality: 85,
		format,
	});

	// Create large version (original size with compression)
	variants.large = await optimizeImage(buffer, {
		quality: 90,
		format,
	});

	return variants;
}

/**
 * Get image metadata without processing
 */
export async function getImageMetadata(buffer: Buffer): Promise<{
	width: number;
	height: number;
	format: string;
	size: number;
	hasAlpha: boolean;
}> {
	try {
		const metadata = await sharp(buffer).metadata();

		return {
			width: metadata.width || 0,
			height: metadata.height || 0,
			format: metadata.format || "unknown",
			size: buffer.length,
			hasAlpha: metadata.hasAlpha || false,
		};
	} catch (error) {
		throw new Error(
			`Failed to get image metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}

/**
 * Validate image format and size
 */
export function validateImage(
	buffer: Buffer,
	maxSizeBytes: number = 10 * 1024 * 1024,
): Promise<boolean> {
	return new Promise(async (resolve) => {
		try {
			// Check file size
			if (buffer.length > maxSizeBytes) {
				resolve(false);
				return;
			}

			// Try to get metadata to validate it's a real image
			const metadata = await getImageMetadata(buffer);

			// Check if it has valid dimensions
			if (metadata.width > 0 && metadata.height > 0) {
				resolve(true);
			} else {
				resolve(false);
			}
		} catch {
			resolve(false);
		}
	});
}

/**
 * Extract dominant colors from image (for UI theming)
 */
export async function extractDominantColors(
	buffer: Buffer,
	count = 3,
): Promise<string[]> {
	try {
		// This is a simplified approach - in production you might want to use a color quantization library
		// For now, return some sample colors based on image analysis
		const metadata = await getImageMetadata(buffer);

		// Return default colors for now - this could be enhanced with actual color analysis
		const colors = ["#4A90E2", "#F5A623", "#D0021B", "#7ED321", "#9013FE"];
		return colors.slice(0, count);
	} catch (error) {
		throw new Error(
			`Color extraction failed: ${error instanceof Error ? error.message : "Unknown error"}`,
		);
	}
}
