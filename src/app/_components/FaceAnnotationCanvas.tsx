"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, Rect, Text, Image as FabricImage } from "fabric";

interface BoundingBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface Face {
	id: number;
	personName?: string;
	confidence?: number | null;
	boundingBox?: BoundingBox;
	isConfirmed: boolean;
	personId?: number | null;
}

interface FaceAnnotationCanvasProps {
	imageUrl: string;
	faces: Face[];
	onFaceClick?: (face: Face) => void;
	className?: string;
	onFullscreen?: () => void;
	hoveredFaceId?: number | null;
}

export default function FaceAnnotationCanvas({
	imageUrl,
	faces,
	onFaceClick,
	className = "",
	onFullscreen,
	hoveredFaceId,
}: FaceAnnotationCanvasProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const fullscreenCanvasRef = useRef<HTMLCanvasElement>(null);
	const fabricCanvasRef = useRef<Canvas | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [isLoaded, setIsLoaded] = useState(false);
	const [isFullscreen, setIsFullscreen] = useState(false);

	useEffect(() => {
		const currentCanvasElement = isFullscreen ? fullscreenCanvasRef.current : canvasRef.current;
		if (!currentCanvasElement) return;

		// Dispose existing canvas if switching modes
		if (fabricCanvasRef.current) {
			fabricCanvasRef.current.dispose();
		}

		// Initialize Fabric.js canvas
		const canvas = new Canvas(currentCanvasElement, {
			selection: false,
			preserveObjectStacking: true,
		});

		fabricCanvasRef.current = canvas;

		return () => {
			canvas.dispose();
		};
	}, [isFullscreen]);

	useEffect(() => {
		if (!fabricCanvasRef.current || !imageUrl) return;

		const canvas = fabricCanvasRef.current;
		canvas.clear();
		setIsLoaded(false);

		// Create a regular HTML image element first to avoid CORS issues
		const htmlImg = new Image();
		
		htmlImg.onload = () => {
			// Create Fabric image from the loaded HTML image
			const img = new FabricImage(htmlImg);
			
			if (!img || !canvas || !containerRef.current) return;

			// Get container dimensions - use full available space
			const containerRect = containerRef.current.getBoundingClientRect();
			const containerWidth = containerRect.width || 800;
			const containerHeight = isFullscreen ? window.innerHeight - 100 : Math.max(384, containerRect.height); // h-96 = 384px minimum
			
			const scaleX = containerWidth / (img.width || 1);
			const scaleY = containerHeight / (img.height || 1);
			const scale = Math.min(scaleX, scaleY);

			// Set canvas dimensions to fill the container
			const canvasWidth = (img.width || 1) * scale;
			const canvasHeight = (img.height || 1) * scale;
			
			canvas.setDimensions({
				width: canvasWidth,
				height: canvasHeight,
			});

			// Scale and add image as background
			img.scale(scale);
			img.set({
				left: 0,
				top: 0,
				selectable: false,
				evented: false,
			});

			canvas.backgroundImage = img;
			canvas.renderAll();

			// Add face bounding boxes
			addFaceBoundingBoxes(canvas, faces, canvasWidth, canvasHeight);
			setIsLoaded(true);
		};

		htmlImg.onerror = (error) => {
			console.error("Failed to load image:", error, "URL:", imageUrl);
			setIsLoaded(false);
		};

		// Load the image (presigned URLs work fine with regular img elements)
		htmlImg.src = imageUrl;
	}, [imageUrl, faces, isFullscreen]);

	// Handle hover highlighting
	useEffect(() => {
		if (!fabricCanvasRef.current || !faces.length || !isLoaded) return;

		const canvas = fabricCanvasRef.current;
		const objects = canvas.getObjects();

		// Reset all face rectangles to normal state
		objects.forEach((obj) => {
			// Check if this is a face rectangle by checking if it has a faceId property
			if (obj.type === 'rect' && (obj as any).faceId !== undefined) {
				const faceId = (obj as any).faceId;
				const face = faces.find(f => f.id === faceId);
				
				if (face) {
					let strokeColor: string;
					if (face.personId) {
						strokeColor = face.isConfirmed ? "#10B981" : "#F59E0B";
					} else {
						strokeColor = "#EF4444";
					}
					
					// Highlight if this face is being hovered
					const isHovered = hoveredFaceId === faceId;
					
					obj.set({
						strokeWidth: isHovered ? 6 : 3,
						stroke: isHovered ? "#3B82F6" : strokeColor, // Blue when hovered
					});
				}
			}
		});

		canvas.renderAll();
	}, [hoveredFaceId, faces, isLoaded]);

	const addFaceBoundingBoxes = (
		canvas: Canvas,
		faces: Face[],
		canvasWidth: number,
		canvasHeight: number
	) => {
		faces.forEach((face, index) => {
			if (!face.boundingBox) return;

			const box = face.boundingBox;
			const x = box.left * canvasWidth;
			const y = box.top * canvasHeight;
			const width = box.width * canvasWidth;
			const height = box.height * canvasHeight;

			// Determine color based on recognition status
			let strokeColor: string;
			if (face.personId) {
				strokeColor = face.isConfirmed ? "#10B981" : "#F59E0B"; // Green for confirmed, yellow for unconfirmed
			} else {
				strokeColor = "#EF4444"; // Red for unknown
			}

			// Create bounding box rectangle
			const rect = new Rect({
				left: x,
				top: y,
				width: width,
				height: height,
				fill: "transparent",
				stroke: strokeColor,
				strokeWidth: 3,
				selectable: false,
				evented: true,
				hoverCursor: "pointer",
			});

			// Add custom property to identify this rectangle
			(rect as any).faceId = face.id;

			// Create face number label
			const label = new Text(`${index + 1}`, {
				left: x,
				top: y - 25,
				fontSize: 16,
				fill: strokeColor,
				fontFamily: "Arial",
				fontWeight: "bold",
				selectable: false,
				evented: false,
				backgroundColor: "rgba(255, 255, 255, 0.8)",
				padding: 4,
			});

			// Add click handler for face selection
			if (onFaceClick) {
				rect.on("mousedown", () => {
					onFaceClick(face);
				});
			}

			// Add hover effects
			rect.on("mouseover", () => {
				rect.set({ strokeWidth: 4 });
				canvas.renderAll();
			});

			rect.on("mouseout", () => {
				rect.set({ strokeWidth: 3 });
				canvas.renderAll();
			});

			canvas.add(rect);
			canvas.add(label);
		});

		canvas.renderAll();
	};

	const toggleFullscreen = () => {
		if (!isFullscreen) {
			setIsFullscreen(true);
			onFullscreen?.();
		} else {
			setIsFullscreen(false);
		}
	};

	// Handle ESC key to exit fullscreen
	useEffect(() => {
		const handleEsc = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && isFullscreen) {
				setIsFullscreen(false);
			}
		};
		
		if (isFullscreen) {
			document.addEventListener('keydown', handleEsc);
			return () => document.removeEventListener('keydown', handleEsc);
		}
	}, [isFullscreen]);

	return (
		<>
			<div 
				ref={containerRef}
				className={`relative ${className} ${isFullscreen ? 'hidden' : ''}`}
			>
				{/* Fullscreen button */}
				<button
					onClick={toggleFullscreen}
					className="absolute top-2 right-2 z-10 bg-black bg-opacity-50 text-white p-2 rounded-lg hover:bg-opacity-70 transition-opacity"
					title="View fullscreen"
				>
					<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
					</svg>
				</button>

				<canvas
					ref={canvasRef}
					className="w-full h-96 object-contain rounded-lg bg-gray-200"
					style={{ display: isLoaded ? "block" : "none" }}
				/>
				{!isLoaded && (
					<div className="flex h-96 items-center justify-center bg-gray-200 rounded-lg">
						<span className="text-gray-500 text-sm">🔍 Loading photo with face detection...</span>
					</div>
				)}
			</div>

			{/* Fullscreen overlay */}
			{isFullscreen && (
				<div className="fixed inset-0 z-50 bg-black bg-opacity-90 flex items-center justify-center">
					<div className="relative w-full h-full p-4">
						{/* Close button */}
						<button
							onClick={() => setIsFullscreen(false)}
							className="absolute top-4 right-4 z-10 bg-white bg-opacity-20 text-white p-3 rounded-lg hover:bg-opacity-30 transition-opacity"
							title="Exit fullscreen (ESC)"
						>
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
							</svg>
						</button>

						{/* Fullscreen canvas container */}
						<div className="w-full h-full flex items-center justify-center">
							<canvas
								ref={fullscreenCanvasRef}
								className="max-w-full max-h-full object-contain"
								style={{ display: isLoaded ? "block" : "none" }}
							/>
							{!isLoaded && (
								<div className="text-white text-lg">🔍 Loading photo with face detection...</div>
							)}
						</div>
					</div>
				</div>
			)}
		</>
	);
}