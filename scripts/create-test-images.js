import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Create test images for face recognition MVP
 */
async function createTestImages() {
	const outputDir = path.join(process.cwd(), "public", "test-images");

	// Ensure output directory exists
	await fs.mkdir(outputDir, { recursive: true });

	// Create a simple group photo simulation with colored rectangles representing people
	const groupPhoto = sharp({
		create: {
			width: 1200,
			height: 800,
			channels: 3,
			background: { r: 135, g: 206, b: 235 }, // Sky blue background
		},
	});

	// Add some "people" as colored rectangles
	const people = [
		{ x: 100, y: 200, color: { r: 255, g: 182, b: 193 } }, // Light pink
		{ x: 300, y: 150, color: { r: 144, g: 238, b: 144 } }, // Light green
		{ x: 500, y: 250, color: { r: 255, g: 165, b: 0 } }, // Orange
		{ x: 700, y: 180, color: { r: 221, g: 160, b: 221 } }, // Plum
		{ x: 900, y: 220, color: { r: 173, g: 216, b: 230 } }, // Light blue
	];

	// Create overlays for each "person"
	const overlays = people.map((person) => ({
		input: {
			create: {
				width: 80,
				height: 120,
				channels: 3,
				background: person.color,
			},
		},
		top: person.y,
		left: person.x,
	}));

	await groupPhoto
		.composite(overlays)
		.jpeg({ quality: 90 })
		.toFile(path.join(outputDir, "group-photo-1.jpg"));

	// Create a second test image
	const groupPhoto2 = sharp({
		create: {
			width: 1000,
			height: 600,
			channels: 3,
			background: { r: 240, g: 248, b: 255 }, // Alice blue background
		},
	});

	const people2 = [
		{ x: 80, y: 150, color: { r: 255, g: 99, b: 71 } }, // Tomato
		{ x: 250, y: 100, color: { r: 60, g: 179, b: 113 } }, // Medium sea green
		{ x: 420, y: 180, color: { r: 255, g: 215, b: 0 } }, // Gold
		{ x: 600, y: 120, color: { r: 138, g: 43, b: 226 } }, // Blue violet
		{ x: 780, y: 200, color: { r: 255, g: 20, b: 147 } }, // Deep pink
		{ x: 350, y: 320, color: { r: 0, g: 191, b: 255 } }, // Deep sky blue
	];

	const overlays2 = people2.map((person) => ({
		input: {
			create: {
				width: 70,
				height: 100,
				channels: 3,
				background: person.color,
			},
		},
		top: person.y,
		left: person.x,
	}));

	await groupPhoto2
		.composite(overlays2)
		.jpeg({ quality: 90 })
		.toFile(path.join(outputDir, "group-photo-2.jpg"));

	// Create a portrait test image
	const portrait = sharp({
		create: {
			width: 400,
			height: 600,
			channels: 3,
			background: { r: 255, g: 248, b: 220 }, // Cornsilk background
		},
	});

	await portrait
		.composite([
			{
				input: {
					create: {
						width: 120,
						height: 160,
						channels: 3,
						background: { r: 205, g: 133, b: 63 }, // Peru color for person
					},
				},
				top: 200,
				left: 140,
			},
		])
		.jpeg({ quality: 90 })
		.toFile(path.join(outputDir, "portrait-1.jpg"));

	console.log("✅ Test images created in public/test-images/");
	console.log("  - group-photo-1.jpg (1200x800, 5 people)");
	console.log("  - group-photo-2.jpg (1000x600, 6 people)");
	console.log("  - portrait-1.jpg (400x600, 1 person)");
}

// Run the script
createTestImages().catch(console.error);
