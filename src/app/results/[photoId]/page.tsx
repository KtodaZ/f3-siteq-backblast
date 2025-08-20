"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { api } from "~/trpc/react";
import FaceAnnotationCanvas from "~/app/_components/FaceAnnotationCanvas";
import FacePreview from "~/app/_components/FacePreview";

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

export default function ResultsPage() {
	const params = useParams();
	const router = useRouter();
	const photoId = Number(params.photoId);
	const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
	const [editingFaceId, setEditingFaceId] = useState<number | null>(null);
	const [tempName, setTempName] = useState("");

	const {
		data: photo,
		isLoading: photoLoading,
		error: photoError,
	} = api.photo.getById.useQuery({ id: photoId }, { enabled: !isNaN(photoId) });

	const { data: photoFaces, isLoading: facesLoading } =
		api.photo.getFaces.useQuery({ photoId }, { enabled: !isNaN(photoId) });

	const utils = api.useUtils();
	const createPersonMutation = api.people.create.useMutation();
	const assignFaceMutation = api.photo.assignFace.useMutation();

	const { data: presignedUrlData } = api.photo.getPresignedUrl.useQuery(
		{ photoId },
		{ enabled: !isNaN(photoId) && !!photo }
	);
	

	// Memoize faces transformation to prevent unnecessary re-renders
	const memoizedFaces = useMemo(() => {
		if (!photoFaces) return [];
		
		
		// Transform and sort faces by position (left-to-right, top-to-bottom)
		const transformedFaces = photoFaces.map(face => {
			const transformed = {
				id: face.id,
				personName: face.person?.name,
				confidence: face.confidence,
				boundingBox: face.boundingBox as BoundingBox,
				isConfirmed: face.isConfirmed ?? false,
				personId: face.personId,
			};
			
			
			return transformed;
		});

		// Sort faces by position: top-to-bottom first, then left-to-right
		return transformedFaces.sort((a, b) => {
			if (!a.boundingBox || !b.boundingBox) return 0;
			
			// Primary sort: top position (smaller top = higher on image)
			const topDiff = a.boundingBox.top - b.boundingBox.top;
			
			// If faces are roughly on the same horizontal line (within 10% of image height)
			if (Math.abs(topDiff) < 0.1) {
				// Secondary sort: left position (smaller left = more to the left)
				return a.boundingBox.left - b.boundingBox.left;
			}
			
			return topDiff;
		});
	}, [photoFaces]);

	const handleFaceClick = (face: Face) => {
		// Find the face index in the sorted array for scrolling
		const faceIndex = memoizedFaces.findIndex(f => f.id === face.id);
		if (faceIndex !== -1) {
			// Scroll to the corresponding face row
			const faceRow = document.getElementById(`face-row-${face.id}`);
			if (faceRow) {
				faceRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
		}

		if (!face.personId) {
			setEditingFaceId(face.id);
			setTempName("");
		}
	};

	const handleAssignName = async (faceId: number, name: string) => {
		if (!faceId || !name.trim()) return;

		try {
			// Create new person
			const newPerson = await createPersonMutation.mutateAsync({
				name: name.trim(),
			});

			// Assign face to person
			await assignFaceMutation.mutateAsync({
				faceId: faceId,
				personId: newPerson.id,
			});

			// Reset states
			setEditingFaceId(null);
			setTempName("");

			// Invalidate React Query cache to refresh data
			await utils.photo.getFaces.invalidate({ photoId });
		} catch (error) {
			console.error("Failed to assign name:", error);
		}
	};

	const handleSaveInlineName = async (faceId: number) => {
		if (!tempName.trim()) return;
		await handleAssignName(faceId, tempName);
	};

	if (isNaN(photoId)) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="font-bold text-2xl text-red-600">Invalid Photo ID</h1>
				<button
					onClick={() => router.push("/upload")}
					className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
				>
					Back to Upload
				</button>
			</div>
		);
	}

	if (photoLoading || facesLoading) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2"></div>
				<p className="mt-4 text-gray-600">Loading photo results...</p>
			</div>
		);
	}

	if (photoError || !photo) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="font-bold text-2xl text-red-600">Photo Not Found</h1>
				<p className="mt-2 text-gray-600">
					The requested photo could not be found.
				</p>
				<button
					onClick={() => router.push("/upload")}
					className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
				>
					Back to Upload
				</button>
			</div>
		);
	}

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8">
			<div className="mb-6">
				<button
					onClick={() => router.push("/upload")}
					className="font-medium text-blue-600 hover:text-blue-800"
				>
					← Back to Upload
				</button>
			</div>

			<h1 className="mb-6 font-bold text-3xl">Face Recognition Results</h1>

			<div className="grid gap-8 lg:grid-cols-2">
				{/* Photo Display */}
				<div className="space-y-4">
					<div className="rounded-lg bg-white p-4 shadow-lg">
						<h2 className="mb-4 font-semibold text-xl">{photo.filename}</h2>

						<div className="relative">
							{/* Photo display with face bounding boxes */}
							{presignedUrlData?.url && memoizedFaces.length > 0 && (
								<FaceAnnotationCanvas
									imageUrl={presignedUrlData.url}
									faces={memoizedFaces}
									onFaceClick={handleFaceClick}
									className="w-full"
									hoveredFaceId={hoveredFaceId}
								/>
							)}
							{(!presignedUrlData?.url || !photoFaces) && (
								<div className="rounded-lg bg-gray-200 h-96 flex items-center justify-center">
									<span className="text-gray-500 text-sm">⏳ Loading image...</span>
								</div>
							)}
						</div>

						<div className="mt-4 text-gray-600 text-sm">
							<p>
								Status:{" "}
								<span className="font-medium">{photo.processingStatus}</span>
							</p>
							<p>
								Faces detected:{" "}
								<span className="font-medium">{photo.faceCount}</span>
							</p>
							<p>
								Uploaded:{" "}
								<span className="font-medium">
									{photo.uploadDate
										? new Date(photo.uploadDate).toLocaleString()
										: "Unknown"}
								</span>
							</p>
						</div>
					</div>
				</div>

				{/* Face List */}
				<div className="space-y-4">
					<div className="rounded-lg bg-white p-4 shadow-lg">
						<h2 className="mb-4 font-semibold text-xl">Detected Faces</h2>

						{photo.processingStatus === "pending" && (
							<div className="py-8 text-center">
								<div className="mx-auto h-8 w-8 animate-spin rounded-full border-blue-500 border-b-2"></div>
								<p className="mt-2 text-gray-600">Processing faces...</p>
							</div>
						)}

						{photo.processingStatus === "failed" && (
							<div className="py-8 text-center text-red-600">
								<p>Face processing failed. Please try uploading again.</p>
							</div>
						)}

						{memoizedFaces && memoizedFaces.length > 0 && (
							<div className="space-y-3">
								{memoizedFaces.map((face, index) => (
									<div 
										key={face.id}
										id={`face-row-${face.id}`}
										className="rounded-lg border p-4 transition-colors hover:bg-blue-50"
										onMouseEnter={() => setHoveredFaceId(face.id)}
										onMouseLeave={() => setHoveredFaceId(null)}
									>
										<div className="flex items-center justify-between">
											<div className="flex items-center space-x-3">
												{/* Face Preview */}
												{face.boundingBox && presignedUrlData?.url ? (
													<FacePreview
														imageUrl={presignedUrlData.url}
														boundingBox={face.boundingBox}
														size={64}
														alt={`Face ${index + 1}`}
														className="border-2 border-gray-200"
													/>
												) : (
													<div 
														className="flex items-center justify-center bg-gray-200 rounded border-2 border-gray-200"
														style={{ width: 64, height: 64 }}
														title={`Missing: ${!face.boundingBox ? 'boundingBox' : ''} ${!presignedUrlData?.url ? 'presignedUrl' : ''}`}
													>
														👤
													</div>
												)}
												
												<div>
													<h3 className="font-medium">Face #{index + 1}</h3>
													{face.personId ? (
														<div>
															<p className="font-medium text-green-600">
																{face.personName}
															</p>
															{face.confidence && (
																<p className="text-gray-600 text-sm">
																	Confidence: {face.confidence.toFixed(1)}%
																</p>
															)}
															<p className="text-gray-500 text-xs">
																{(face.isConfirmed ?? false)
																	? "Confirmed"
																	: "Needs confirmation"}
															</p>
														</div>
													) : (
														<p className="text-orange-600">Unknown person</p>
													)}
												</div>
											</div>

											<div className="flex space-x-2">
												{!face.personId && (
													<div className="flex items-center space-x-2">
														{editingFaceId === face.id ? (
															<>
																<input
																	type="text"
																	value={tempName}
																	onChange={(e) => setTempName(e.target.value)}
																	placeholder="Enter name"
																	className="rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
																	autoFocus
																	onKeyDown={(e) => {
																		if (e.key === 'Enter') {
																			handleSaveInlineName(face.id);
																		} else if (e.key === 'Escape') {
																			setEditingFaceId(null);
																			setTempName("");
																		}
																	}}
																/>
																<button
																	onClick={() => handleSaveInlineName(face.id)}
																	disabled={!tempName.trim() || createPersonMutation.isPending}
																	className="rounded bg-green-500 px-2 py-1 text-xs text-white hover:bg-green-600 disabled:bg-gray-400"
																>
																	{createPersonMutation.isPending ? "..." : "✓"}
																</button>
																<button
																	onClick={() => {
																		setEditingFaceId(null);
																		setTempName("");
																	}}
																	className="rounded bg-gray-500 px-2 py-1 text-xs text-white hover:bg-gray-600"
																>
																	✕
																</button>
															</>
														) : (
															<button
																onClick={() => {
																	setEditingFaceId(face.id);
																	setTempName("");
																}}
																className="rounded bg-blue-500 px-3 py-1 text-sm text-white hover:bg-blue-600"
															>
																Add Name
															</button>
														)}
													</div>
												)}

												<div
													className="h-3 w-3 rounded-full"
													style={{
														backgroundColor: face.personId
															? face.isConfirmed
																? "#10B981"
																: "#F59E0B"
															: "#EF4444",
													}}
												></div>
											</div>
										</div>
									</div>
								))}
							</div>
						)}

						{memoizedFaces &&
							memoizedFaces.length === 0 &&
							photo.processingStatus === "completed" && (
								<div className="py-8 text-center text-gray-600">
									<p>No faces detected in this photo.</p>
								</div>
							)}
					</div>

					{/* Legend */}
					<div className="rounded-lg bg-gray-50 p-4">
						<h3 className="mb-2 font-medium">Legend</h3>
						<div className="space-y-1 text-sm">
							<div className="flex items-center space-x-2">
								<div className="h-3 w-3 rounded-full bg-green-500"></div>
								<span>Confirmed person</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="h-3 w-3 rounded-full bg-yellow-500"></div>
								<span>Recognized but unconfirmed</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="h-3 w-3 rounded-full bg-red-500"></div>
								<span>Unknown person</span>
							</div>
						</div>
					</div>
				</div>
			</div>

		</div>
	);
}
