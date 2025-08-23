"use client";

import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import FaceAnnotationCanvas from "~/app/_components/FaceAnnotationCanvas";
import FacePreview from "~/app/_components/FacePreview";
import { api } from "~/trpc/react";

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
	isOptimisticLoading?: boolean;
}

export default function ResultsPage() {
	const params = useParams();
	const router = useRouter();
	const photoId = Number(params.photoId);
	const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null);
	const [faceInputs, setFaceInputs] = useState<Map<number, string>>(new Map());
	const [reassigningFaceId, setReassigningFaceId] = useState<number | null>(
		null,
	);
	const [showSuggestions, setShowSuggestions] = useState<Map<number, boolean>>(new Map());
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<Map<number, number>>(new Map());
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [processingFaces, setProcessingFaces] = useState<Set<number>>(new Set());
	
	// Optimistic updates state
	const [optimisticFaceUpdates, setOptimisticFaceUpdates] = useState<Map<number, {
		personId: number | null;
		personName: string | null;
		confidence: number | null;
		isConfirmed: boolean;
		isLoading: boolean;
	}>>(new Map());


	const {
		data: photo,
		isLoading: photoLoading,
		error: photoError,
	} = api.photo.getById.useQuery(
		{ id: photoId },
		{
			enabled: !Number.isNaN(photoId),
			// Simple polling for processing status
			refetchInterval: 5000, // Poll every 5 seconds
			refetchOnWindowFocus: true,
		},
	);

	const { data: photoFaces, isLoading: facesLoading } =
		api.photo.getFaces.useQuery(
			{ photoId },
			{
				enabled: !Number.isNaN(photoId),
				// Poll for faces when photo is processing
				refetchInterval: 5000, // Simple 5-second polling
			},
		);

	const utils = api.useUtils();
	const createPersonMutation = api.people.create.useMutation();
	const createPersonWithFaceMutation =
		api.people.createPersonWithFace.useMutation();
	const assignFaceMutation = api.photo.assignFace.useMutation();
	const reassignFaceMutation = api.photo.reassignFace.useMutation();

	// Get all people for reassignment dropdown
	const { data: allPeople } = api.people.getAll.useQuery({
		limit: 100,
		offset: 0,
	});

	const { data: presignedUrlData } = api.photo.getPresignedUrl.useQuery(
		{ photoId },
		{ enabled: !Number.isNaN(photoId) && !!photo },
	);

	// Memoize faces transformation to prevent unnecessary re-renders
	const memoizedFaces = useMemo(() => {
		if (!photoFaces) return [];

		// Transform and sort faces by position (left-to-right, top-to-bottom)
		const transformedFaces = photoFaces.map((face) => {
			// Check for optimistic updates
			const optimisticUpdate = optimisticFaceUpdates.get(face.id);
			
			const transformed = {
				id: face.id,
				personName: optimisticUpdate?.personName ?? face.person?.name,
				confidence: optimisticUpdate?.confidence ?? face.confidence,
				boundingBox: face.boundingBox as BoundingBox,
				isConfirmed: optimisticUpdate?.isConfirmed ?? face.isConfirmed ?? false,
				personId: optimisticUpdate?.personId ?? face.personId,
				isOptimisticLoading: optimisticUpdate?.isLoading ?? false,
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
	}, [photoFaces, optimisticFaceUpdates]);

	const handleFaceClick = (face: Face) => {
		// Find the face index in the sorted array for scrolling
		const faceIndex = memoizedFaces.findIndex((f) => f.id === face.id);
		if (faceIndex !== -1) {
			// Scroll to the corresponding face row
			const faceRow = document.getElementById(`face-row-${face.id}`);
			if (faceRow) {
				faceRow.scrollIntoView({ behavior: "smooth", block: "center" });
			}
		}

		// Just scroll to face when clicked
	};

	const handleAssignName = async (faceId: number, name: string) => {
		if (!faceId || !name.trim()) return;
		
		// Prevent duplicate submissions
		if (processingFaces.has(faceId)) {
			console.log(`🚫 Face ${faceId} is already being processed, ignoring duplicate submission`);
			return;
		}
		
		// Check for duplicate person assignment in this photo
		if (wouldCreateDuplicate(name)) {
			setErrorMessage(`"${name}" is already assigned to another face in this photo. Please choose a different name or correct the existing assignment.`);
			setTimeout(() => setErrorMessage(null), 8000);
			return;
		}

		// Mark face as processing
		setProcessingFaces(prev => new Set(prev.add(faceId)));

		// Optimistic update - immediately show the new person assignment
		setOptimisticFaceUpdates(prev => new Map(prev.set(faceId, {
			personId: -1, // Temporary ID for new person
			personName: name.trim(),
			confidence: null, // Will show loading placeholder
			isConfirmed: false,
			isLoading: true,
		})));

		// Reset input states immediately
		setFaceInputs(prev => new Map(prev.set(faceId, "")));

		try {
			// Clear any previous messages
			setErrorMessage(null);
			setSuccessMessage(null);

			// Use atomic operation to create person and index face
			const result = await createPersonWithFaceMutation.mutateAsync({
				name: name.trim(),
				faceId: faceId,
			});

			// Show success message based on whether face was indexed
			if (result.indexed) {
				setSuccessMessage(result.message);
				console.log(`✅ ${result.message}`);
			} else {
				setSuccessMessage(result.message);
				console.warn(`⚠️ ${result.message}`);
			}

			// Clear success message after 5 seconds
			setTimeout(() => setSuccessMessage(null), 5000);

			// Invalidate React Query cache to refresh data
			await Promise.all([
				utils.photo.getFaces.invalidate({ photoId }),
				utils.people.getAll.invalidate(), // Refresh people list for autocomplete
			]);

			// Clear optimistic update and processing state after data refresh
			setOptimisticFaceUpdates(prev => {
				const newMap = new Map(prev);
				newMap.delete(faceId);
				return newMap;
			});
			
			setProcessingFaces(prev => {
				const newSet = new Set(prev);
				newSet.delete(faceId);
				return newSet;
			});
		} catch (error: unknown) {
			console.error("Failed to create person with face:", error);

			// Revert optimistic update on error
			setOptimisticFaceUpdates(prev => {
				const newMap = new Map(prev);
				newMap.delete(faceId);
				return newMap;
			});
			
			// Clear processing state on error
			setProcessingFaces(prev => {
				const newSet = new Set(prev);
				newSet.delete(faceId);
				return newSet;
			});

			// Extract error message from tRPC error
			let errorMsg = "Failed to create person. Please try again.";
			if ((error as any)?.message) {
				errorMsg = (error as any).message;
			} else if ((error as any)?.data?.message) {
				errorMsg = (error as any).data.message;
			}

			setErrorMessage(errorMsg);

			// Clear error message after 10 seconds
			setTimeout(() => setErrorMessage(null), 10000);
		}
	};

	const handleSaveInlineName = async (faceId: number) => {
		const tempName = faceInputs.get(faceId) || "";
		if (!tempName.trim()) return;
		await handleAssignName(faceId, tempName);
	};

	const handleAssignToExistingPerson = async (
		faceId: number,
		personId: number,
	) => {
		// Prevent duplicate submissions
		if (processingFaces.has(faceId)) {
			console.log(`🚫 Face ${faceId} is already being processed, ignoring duplicate assignment`);
			return;
		}

		// Find the person name for optimistic update
		const person = allPeople?.find(p => p.id === personId);
		if (!person) return;
		
		// Check if this person is already assigned to another face in this photo
		const assignedPeopleIds = getAssignedPeopleInPhoto();
		if (assignedPeopleIds.has(personId)) {
			setErrorMessage(`"${person.name}" is already assigned to another face in this photo. Please choose a different person or correct the existing assignment.`);
			setTimeout(() => setErrorMessage(null), 8000);
			return;
		}

		// Mark face as processing
		setProcessingFaces(prev => new Set(prev.add(faceId)));

		// Optimistic update - immediately show the assignment
		setOptimisticFaceUpdates(prev => new Map(prev.set(faceId, {
			personId: personId,
			personName: person.name,
			confidence: null, // Will show loading placeholder
			isConfirmed: false, // Will be updated when backend responds
			isLoading: true,
		})));

		// Reset input states immediately
		setFaceInputs(prev => new Map(prev.set(faceId, "")));
		setShowSuggestions(prev => new Map(prev.set(faceId, false)));
		setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, -1)));

		try {
			// Assign face to existing person directly
			await assignFaceMutation.mutateAsync({
				faceId: faceId,
				personId: personId,
			});

			// Invalidate React Query cache to refresh data
			await Promise.all([
				utils.photo.getFaces.invalidate({ photoId }),
				utils.people.getAll.invalidate(), // Refresh people list for autocomplete
				utils.people.getById.invalidate({ id: personId }), // Refresh person detail if open
			]);

			// Clear optimistic update and processing state after data refresh
			setOptimisticFaceUpdates(prev => {
				const newMap = new Map(prev);
				newMap.delete(faceId);
				return newMap;
			});
			
			setProcessingFaces(prev => {
				const newSet = new Set(prev);
				newSet.delete(faceId);
				return newSet;
			});
		} catch (error) {
			console.error("Failed to assign to existing person:", error);
			
			// Revert optimistic update on error
			setOptimisticFaceUpdates(prev => {
				const newMap = new Map(prev);
				newMap.delete(faceId);
				return newMap;
			});
			
			// Clear processing state on error
			setProcessingFaces(prev => {
				const newSet = new Set(prev);
				newSet.delete(faceId);
				return newSet;
			});
			
			// Show error message
			setErrorMessage("Failed to assign face to person. Please try again.");
			setTimeout(() => setErrorMessage(null), 5000);
		}
	};

	const handleReassignFace = async (
		faceId: number,
		newPersonId: number | null,
	) => {
		try {
			await reassignFaceMutation.mutateAsync({
				faceId,
				newPersonId,
			});

			// Reset reassignment state
			setReassigningFaceId(null);

			// Invalidate React Query cache to refresh data
			await Promise.all([
				utils.photo.getFaces.invalidate({ photoId }),
				utils.people.getAll.invalidate(), // Refresh people list for autocomplete
				// If reassigning to a person, invalidate that person's data too
				...(newPersonId
					? [utils.people.getById.invalidate({ id: newPersonId })]
					: []),
			]);
		} catch (error) {
			console.error("Failed to reassign face:", error);
		}
	};

	// Get currently assigned people in this photo to prevent duplicates
	const getAssignedPeopleInPhoto = () => {
		if (!memoizedFaces) return new Set<number>();
		
		return new Set(
			memoizedFaces
				.filter(face => face.personId && !optimisticFaceUpdates.has(face.id))
				.map(face => face.personId!)
		);
	};

	// Filter suggestions based on input and prevent duplicates
	const getFilteredSuggestions = (faceId: number) => {
		const tempName = faceInputs.get(faceId) || "";
		if (!tempName.trim() || !allPeople) return [];

		const query = tempName.toLowerCase();
		const assignedPeopleIds = getAssignedPeopleInPhoto();
		
		return allPeople
			.filter((person) => 
				person.name.toLowerCase().includes(query) && 
				!assignedPeopleIds.has(person.id) // Exclude already assigned people
			)
			.slice(0, 5); // Limit to 5 suggestions
	};

	// Check if a person name would create a duplicate assignment
	const wouldCreateDuplicate = (personName: string) => {
		if (!memoizedFaces || !personName.trim()) return false;
		
		return memoizedFaces.some(face => 
			face.personName?.toLowerCase() === personName.toLowerCase() &&
			!optimisticFaceUpdates.has(face.id)
		);
	};

	const handleInputChange = (faceId: number, value: string) => {
		setFaceInputs(prev => new Map(prev.set(faceId, value)));
		setShowSuggestions(prev => new Map(prev.set(faceId, value.trim().length > 0)));
		setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, -1)));
	};

	const handleKeyDown = (e: React.KeyboardEvent, faceId: number) => {
		const tempName = faceInputs.get(faceId) || "";
		const suggestions = getFilteredSuggestions(faceId);
		const currentSelectedIndex = selectedSuggestionIndex.get(faceId) || -1;
		const hasCreateOption =
			tempName.trim().length > 0 &&
			!suggestions.some((p) => p.name.toLowerCase() === tempName.toLowerCase());
		const totalOptions = suggestions.length + (hasCreateOption ? 1 : 0);

		// Only handle navigation keys when suggestions are visible
		const showingSuggestions = showSuggestions.get(faceId) && tempName.trim().length > 0;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			if (!showingSuggestions) {
				// Show suggestions if hidden
				setShowSuggestions(prev => new Map(prev.set(faceId, true)));
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, 0)));
			} else {
				// Navigate down, wrap to top if at end
				const newIndex = currentSelectedIndex < totalOptions - 1 ? currentSelectedIndex + 1 : 0;
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, newIndex)));
			}
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			if (!showingSuggestions) {
				// Show suggestions if hidden, select last item
				setShowSuggestions(prev => new Map(prev.set(faceId, true)));
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, totalOptions - 1)));
			} else {
				// Navigate up, wrap to bottom if at top, or go to -1 (no selection)
				const newIndex = currentSelectedIndex <= 0 ? totalOptions - 1 : currentSelectedIndex - 1;
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, newIndex)));
			}
		} else if (e.key === "Tab") {
			if (showingSuggestions && totalOptions > 0) {
				e.preventDefault();
				// Tab cycles forward through options
				const newIndex = currentSelectedIndex < totalOptions - 1 ? currentSelectedIndex + 1 : 0;
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, newIndex)));
			}
		} else if (e.key === "Home") {
			if (showingSuggestions && totalOptions > 0) {
				e.preventDefault();
				// Jump to first option
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, 0)));
			}
		} else if (e.key === "End") {
			if (showingSuggestions && totalOptions > 0) {
				e.preventDefault();
				// Jump to last option
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, totalOptions - 1)));
			}
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (currentSelectedIndex >= 0 && showingSuggestions) {
				if (currentSelectedIndex < suggestions.length) {
					// Select existing person
					const selectedPerson = suggestions[currentSelectedIndex];
					if (selectedPerson) {
						handleAssignToExistingPerson(faceId, selectedPerson.id);
					}
				} else if (hasCreateOption) {
					// Create new person
					handleSaveInlineName(faceId);
				}
			} else if (hasCreateOption) {
				// No selection, create new person
				handleSaveInlineName(faceId);
			}
		} else if (e.key === "Escape") {
			if (showingSuggestions) {
				// First escape hides suggestions
				setShowSuggestions(prev => new Map(prev.set(faceId, false)));
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, -1)));
			} else {
				// Second escape clears input
				setFaceInputs(prev => new Map(prev.set(faceId, "")));
				setSelectedSuggestionIndex(prev => new Map(prev.set(faceId, -1)));
			}
		}
	};

	if (Number.isNaN(photoId)) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="font-bold text-2xl text-red-600">Invalid Photo ID</h1>
				<button
					type="button"
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
				<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
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
					type="button"
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
					type="button"
					onClick={() => router.push("/upload")}
					className="font-medium text-blue-600 hover:text-blue-800"
				>
					← Back to Upload
				</button>
			</div>

			<h1 className="mb-6 font-bold text-3xl">Face Recognition Results</h1>

			{/* Success Message */}
			{successMessage && (
				<div className="mb-4 rounded-lg border border-green-400 bg-green-100 p-4 text-green-700">
					<div className="flex items-center">
						<span className="mr-2">✅</span>
						<span>{successMessage}</span>
					</div>
				</div>
			)}

			{/* Error Message */}
			{errorMessage && (
				<div className="mb-4 rounded-lg border border-red-400 bg-red-100 p-4 text-red-700">
					<div className="flex items-center justify-between">
						<div className="flex items-center">
							<span className="mr-2">❌</span>
							<span>{errorMessage}</span>
						</div>
						<button
							type="button"
							onClick={() => setErrorMessage(null)}
							className="ml-4 text-red-500 hover:text-red-700"
						>
							✕
						</button>
					</div>
				</div>
			)}

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
								<div className="flex h-96 items-center justify-center rounded-lg bg-gray-200">
									<span className="text-gray-500 text-sm">
										⏳ Loading image...
									</span>
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

						{/* PAX List */}
						{memoizedFaces && memoizedFaces.length > 0 && (
							<div className="mt-6 rounded-lg bg-gray-50 p-4">
								<h3 className="mb-3 font-semibold text-lg">PAX: {memoizedFaces.length}</h3>
								<div className="grid grid-cols-1 gap-2 text-sm">
									{memoizedFaces.map((face, index) => (
										<div key={face.id} className="flex items-center space-x-2">
											<span className={face.personName ? "text-gray-900" : "text-orange-600"}>
												@{face.personName || `Unknown ${index + 1}`}
											</span>
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Face List */}
				<div className="space-y-4">
					<div className="rounded-lg bg-white p-4 shadow-lg">
						<h2 className="mb-4 font-semibold text-xl">Detected Faces</h2>

						{photo.processingStatus === "pending" && (
							<div className="py-8 text-center">
								<div className="mx-auto h-8 w-8 animate-spin rounded-full border-blue-500 border-b-2" />
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
												{presignedUrlData?.url && face.boundingBox ? (
													<FacePreview
														imageUrl={presignedUrlData.url}
														boundingBox={face.boundingBox}
														size={64}
														alt={`Face ${index + 1}`}
														className="border-2 border-gray-200"
													/>
												) : (
													<div
														className="flex items-center justify-center rounded border-2 border-gray-200 bg-gray-200"
														style={{ width: 64, height: 64 }}
													>
														👤
													</div>
												)}

												<div>
													<h3 className="font-medium">Face #{index + 1}</h3>
													{face.personId ? (
														<div>
															<p className={`font-medium ${face.isOptimisticLoading ? "text-blue-600" : "text-green-600"}`}>
																{face.personName}
																{face.isOptimisticLoading && (
																	<span className="ml-2 text-blue-500">⏳</span>
																)}
															</p>
															{face.confidence ? (
																<div className="flex items-center space-x-2">
																	<span className="text-gray-600 text-sm">
																		Confidence:
																	</span>
																	<span
																		className={`rounded px-2 py-1 font-medium text-xs ${
																			face.confidence >= 85
																				? "bg-green-100 text-green-800"
																				: face.confidence >= 70
																					? "bg-yellow-100 text-yellow-800"
																					: "bg-red-100 text-red-800"
																		}`}
																	>
																		{face.confidence.toFixed(1)}%
																		{face.confidence >= 85
																			? " 🌟"
																			: face.confidence >= 70
																				? " ⚠️"
																				: " 🔍"}
																	</span>
																</div>
															) : face.isOptimisticLoading ? (
																<div className="flex items-center space-x-2">
																	<span className="text-gray-600 text-sm">
																		Confidence:
																	</span>
																	<span className="rounded bg-blue-100 px-2 py-1 text-blue-800 text-xs">
																		Processing... ⏳
																	</span>
																</div>
															) : null}
															{face.confidence && face.confidence < 70 && (
																<span className="rounded bg-orange-100 px-2 py-1 text-orange-800 text-xs">
																	🔍 Low Quality
																</span>
															)}
														</div>
													) : processingFaces.has(face.id) ? (
														<p className="text-blue-600">🔄 Processing assignment...</p>
													) : (
														<p className="text-orange-600">Unknown person</p>
													)}
												</div>
											</div>

											<div className="flex space-x-2">
												{!face.personId && !processingFaces.has(face.id) && (
													<div className="flex items-center space-x-2">
														<div className="relative">
															<div className="flex items-center space-x-2">
																<input
																	type="text"
																	value={faceInputs.get(face.id) || ""}
																	onChange={(e) =>
																		handleInputChange(face.id, e.target.value)
																	}
																	placeholder="Search existing or type new name..."
																	className={`w-48 rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 ${
																		wouldCreateDuplicate(faceInputs.get(face.id) || "") 
																			? "border-red-400 focus:ring-red-500" 
																			: "focus:ring-blue-500"
																	}`}
																	onKeyDown={(e) => handleKeyDown(e, face.id)}
																	role="combobox"
																	aria-expanded={showSuggestions.get(face.id) || false}
																	aria-haspopup="listbox"
																	aria-autocomplete="list"
																	aria-label="Person name input with autocomplete"
																	onFocus={() =>
																		setShowSuggestions(prev => 
																			new Map(prev.set(face.id, (faceInputs.get(face.id) || "").trim().length > 0))
																		)
																	}
																	onBlur={() => {
																		// Delay hiding to allow clicks on suggestions
																		setTimeout(
																			() => setShowSuggestions(prev => 
																				new Map(prev.set(face.id, false))
																			),
																			150,
																		);
																	}}
																/>
																<button
																	type="button"
																	onClick={() => {
																		const tempName = faceInputs.get(face.id) || "";
																		const suggestions = getFilteredSuggestions(face.id);
																		if (
																			suggestions.length > 0 &&
																			suggestions.some(
																				(p) =>
																					p.name.toLowerCase() ===
																					tempName.toLowerCase(),
																			) &&
																			!wouldCreateDuplicate(tempName)
																		) {
																			// Exact match found, assign to existing
																			const exactMatch = suggestions.find(
																				(p) =>
																					p.name.toLowerCase() ===
																					tempName.toLowerCase(),
																			);
																			if (exactMatch) {
																				handleAssignToExistingPerson(
																					face.id,
																					exactMatch.id,
																				);
																			}
																		} else if (!wouldCreateDuplicate(tempName)) {
																			// Create new person (only if not duplicate)
																			handleSaveInlineName(face.id);
																		}
																	}}
																	disabled={
																		!(faceInputs.get(face.id) || "").trim() ||
																		createPersonWithFaceMutation.isPending ||
																		wouldCreateDuplicate(faceInputs.get(face.id) || "")
																	}
																	className={`rounded px-2 py-1 text-white text-xs disabled:bg-gray-400 ${
																		wouldCreateDuplicate(faceInputs.get(face.id) || "") 
																			? "bg-red-500 hover:bg-red-600" 
																			: "bg-green-500 hover:bg-green-600"
																	}`}
																>
																	{createPersonWithFaceMutation.isPending
																		? "..."
																		: wouldCreateDuplicate(faceInputs.get(face.id) || "")
																			? "!"
																			: "✓"}
																</button>
																<button
																	type="button"
																	onClick={() => {
																		setFaceInputs(prev => new Map(prev.set(face.id, "")));
																		setShowSuggestions(prev => new Map(prev.set(face.id, false)));
																		setSelectedSuggestionIndex(prev => new Map(prev.set(face.id, -1)));
																	}}
																	className="rounded bg-gray-500 px-2 py-1 text-white text-xs hover:bg-gray-600"
																>
																	✕
																</button>
															</div>

															{/* Autocomplete Dropdown */}
															{showSuggestions.get(face.id) && (faceInputs.get(face.id) || "").trim() && (
																<div 
																	className="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg"
																	role="listbox"
																	aria-label="Person suggestions"
																>
																	{(() => {
																		const tempName = faceInputs.get(face.id) || "";
																		const suggestions = getFilteredSuggestions(face.id);
																		const currentSelectedIndex = selectedSuggestionIndex.get(face.id) || -1;
																		const isDuplicate = wouldCreateDuplicate(tempName);
																		const hasCreateOption =
																			tempName.trim().length > 0 &&
																			!isDuplicate &&
																			!suggestions.some(
																				(p) =>
																					p.name.toLowerCase() ===
																					tempName.toLowerCase(),
																			);

																		return (
																			<>
																				{/* Duplicate warning */}
																				{isDuplicate && (
																					<div className="bg-red-50 border-red-200 border-l-4 px-3 py-2 text-sm text-red-700">
																						<div className="flex items-center space-x-2">
																							<span>⚠️</span>
																							<span className="font-medium">"{tempName}" is already assigned in this photo</span>
																						</div>
																					</div>
																				)}

																				{/* Existing people suggestions */}
																				{suggestions.map((person, index) => (
																					<div
																						key={person.id}
																						role="option"
																						aria-selected={currentSelectedIndex === index}
																						className={`cursor-pointer px-3 py-2 text-sm transition-colors ${
																							currentSelectedIndex === index
																								? "bg-blue-500 text-white font-medium"
																								: "hover:bg-gray-100 text-gray-900"
																						} focus:outline-none focus:bg-blue-500 focus:text-white`}
																						onClick={() =>
																							handleAssignToExistingPerson(
																								face.id,
																								person.id,
																							)
																						}
																						onMouseEnter={() =>
																							setSelectedSuggestionIndex(prev => 
																								new Map(prev.set(face.id, index))
																							)
																						}
																					>
																						<div className="flex items-center justify-between">
																							<span className="font-medium">
																								👤 {person.name}
																							</span>
																							<span className="text-gray-500 text-xs">
																								{person.faceEncodings
																									?.length || 0}{" "}
																								faces
																							</span>
																						</div>
																					</div>
																				))}

																				{/* Create new person option */}
																				{hasCreateOption && (
																					<div
																						role="option"
																						aria-selected={currentSelectedIndex === suggestions.length}
																						className={`cursor-pointer border-gray-100 border-t px-3 py-2 text-sm transition-colors ${
																							currentSelectedIndex === suggestions.length
																								? "bg-green-500 text-white font-medium"
																								: "hover:bg-gray-100 text-gray-900"
																						} focus:outline-none focus:bg-green-500 focus:text-white`}
																						onClick={() =>
																							handleSaveInlineName(face.id)
																						}
																						onMouseEnter={() =>
																							setSelectedSuggestionIndex(prev => 
																								new Map(prev.set(face.id, suggestions.length))
																							)
																						}
																					>
																						<span className="font-medium">
																							➕ Create new person: "
																							{tempName}"
																						</span>
																					</div>
																				)}
																			</>
																		);
																	})()}
																</div>
															)}
														</div>
													</div>
												)}

												{face.personId && (
													<div className="flex items-center space-x-2">
														{reassigningFaceId === face.id ? (
															<>
																<select
																	onChange={(e) => {
																		const newPersonId = e.target.value
																			? Number(e.target.value)
																			: null;
																		handleReassignFace(face.id, newPersonId);
																	}}
																	className="rounded border px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
																	defaultValue=""
																>
																	<option value="">Select person...</option>
																	<option value="">❌ Mark as Unknown</option>
																	{allPeople?.map((person) => (
																		<option key={person.id} value={person.id}>
																			{person.name}
																		</option>
																	))}
																</select>
																<button
																	type="button"
																	onClick={() => setReassigningFaceId(null)}
																	className="rounded bg-gray-500 px-2 py-1 text-white text-xs hover:bg-gray-600"
																>
																	✕
																</button>
															</>
														) : (
															<button
																type="button"
																onClick={() => setReassigningFaceId(face.id)}
																disabled={reassignFaceMutation.isPending}
																className="rounded bg-orange-500 px-3 py-1 text-sm text-white hover:bg-orange-600 disabled:bg-gray-400"
															>
																{reassignFaceMutation.isPending
																	? "..."
																	: "Correct"}
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
												/>
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
								<div className="h-3 w-3 rounded-full bg-green-500" />
								<span>Confirmed person</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="h-3 w-3 rounded-full bg-yellow-500" />
								<span>Recognized but unconfirmed</span>
							</div>
							<div className="flex items-center space-x-2">
								<div className="h-3 w-3 rounded-full bg-red-500" />
								<span>Unknown person</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
