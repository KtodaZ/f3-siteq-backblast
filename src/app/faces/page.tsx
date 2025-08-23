"use client";

import { useState } from "react";
import FacePreview from "~/app/_components/FacePreview";
import { api } from "~/trpc/react";

// Type definitions for face data
interface BoundingBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface Person {
	id: number;
	name: string;
}

interface Photo {
	id: number;
	filename: string;
	s3Key: string;
}

interface PhotoFace {
	id: number;
	confidence: number | null;
	boundingBox: BoundingBox | null | unknown;
	photo: Photo | null;
}

interface FaceEncoding {
	id: number;
	personId: number | null;
	awsFaceId: string;
	confidence: number | null;
	createdAt: Date | null;
	totalInstances: number;
	person: Person | null;
	bestPhotoFace: PhotoFace | null | undefined;
	associatedPhotoFaces: PhotoFace[];
}

interface DuplicateGroup {
	person: Person | null;
	encodings: FaceEncoding[];
}

export default function FacesPage() {
	const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);
	const [viewMode, setViewMode] = useState<"all" | "duplicates">("all");
	const [searchQuery, setSearchQuery] = useState("");
	const [expandedFaceId, setExpandedFaceId] = useState<number | null>(null);

	const utils = api.useUtils();

	const {
		data: allFaceEncodings,
		isLoading: isLoadingAll,
		refetch: refetchAll,
	} = api.faces.getAll.useQuery({
		limit: 200,
		offset: 0,
	});

	const {
		data: duplicateGroups,
		isLoading: isLoadingDuplicates,
		refetch: refetchDuplicates,
	} = api.faces.findDuplicates.useQuery();

	const deleteFaceMutation = api.faces.delete.useMutation({
		onSuccess: () => {
			setSelectedFaceIds([]);
			// Invalidate all related data when face encodings are deleted
			utils.faces.getAll.invalidate();
			utils.faces.findDuplicates.invalidate();
			utils.people.getAll.invalidate(); // Update people face counts
		},
	});

	const bulkDeleteFacesMutation = api.faces.bulkDelete.useMutation({
		onSuccess: () => {
			setSelectedFaceIds([]);
			// Invalidate all related data when face encodings are deleted
			utils.faces.getAll.invalidate();
			utils.faces.findDuplicates.invalidate();
			utils.people.getAll.invalidate(); // Update people face counts
		},
	});

	const handleDeleteFace = async (
		faceEncodingId: number,
		personName: string,
		totalInstances?: number,
	) => {
		const instanceText = totalInstances
			? ` This will affect ${totalInstances} face detections across photos.`
			: "";
		if (
			confirm(
				`Are you sure you want to delete this face encoding for "${personName}"? This will remove it from both the database and AWS Rekognition.${instanceText}`,
			)
		) {
			await deleteFaceMutation.mutateAsync({ faceEncodingId });
		}
	};

	const handleBulkDelete = async () => {
		if (selectedFaceIds.length === 0) return;

		if (
			confirm(
				`Are you sure you want to delete ${selectedFaceIds.length} face encodings? This will remove them from both the database and AWS Rekognition.`,
			)
		) {
			await bulkDeleteFacesMutation.mutateAsync({
				faceEncodingIds: selectedFaceIds,
			});
		}
	};

	const toggleFaceSelection = (faceId: number) => {
		setSelectedFaceIds((prev) =>
			prev.includes(faceId)
				? prev.filter((id) => id !== faceId)
				: [...prev, faceId],
		);
	};

	const selectAllDuplicates = () => {
		if (!duplicateGroups) return;

		const allDuplicateIds: number[] = [];
		for (const group of duplicateGroups) {
			// Select all but the highest confidence face for each person
			const sorted = group.encodings.sort(
				(a, b) => (b.confidence || 0) - (a.confidence || 0),
			);
			const duplicatesToSelect = sorted.slice(1); // Keep the first (highest confidence), select the rest
			allDuplicateIds.push(...duplicatesToSelect.map((face) => face.id));
		}

		setSelectedFaceIds(allDuplicateIds);
	};

	const isLoading = isLoadingAll || isLoadingDuplicates;

	// Filter faces based on search query
	const filteredFaces = allFaceEncodings?.filter((face) =>
		face.person?.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
					<p className="mt-4 text-gray-600">Loading face encodings...</p>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto px-4 py-8">
			{/* Header */}
			<div className="mb-8 flex items-center justify-between">
				<h1 className="font-bold text-3xl">Face Management</h1>
				<div className="flex space-x-3">
					{selectedFaceIds.length > 0 && (
						<button
							type="button"
							onClick={handleBulkDelete}
							disabled={bulkDeleteFacesMutation.isPending}
							className="rounded-lg bg-red-500 px-4 py-2 text-white transition-colors hover:bg-red-600 disabled:bg-gray-400"
						>
							{bulkDeleteFacesMutation.isPending
								? "Deleting..."
								: `Delete Selected (${selectedFaceIds.length})`}
						</button>
					)}
				</div>
			</div>

			{/* Controls */}
			<div className="mb-6 flex flex-col space-y-4 md:flex-row md:items-center md:space-x-4 md:space-y-0">
				{/* View Mode Toggle */}
				<div className="flex rounded-lg bg-gray-200 p-1">
					<button
						type="button"
						onClick={() => setViewMode("all")}
						className={`rounded-md px-4 py-2 font-medium text-sm transition-colors ${
							viewMode === "all"
								? "bg-white text-blue-600 shadow"
								: "text-gray-600 hover:text-gray-900"
						}`}
					>
						All Faces ({allFaceEncodings?.length || 0})
					</button>
					<button
						type="button"
						onClick={() => setViewMode("duplicates")}
						className={`rounded-md px-4 py-2 font-medium text-sm transition-colors ${
							viewMode === "duplicates"
								? "bg-white text-blue-600 shadow"
								: "text-gray-600 hover:text-gray-900"
						}`}
					>
						Duplicates ({duplicateGroups?.length || 0} people)
					</button>
				</div>

				{/* Search */}
				{viewMode === "all" && (
					<input
						type="text"
						placeholder="Search by person name..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="flex-1 rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				)}

				{/* Bulk Actions */}
				{viewMode === "duplicates" &&
					duplicateGroups &&
					duplicateGroups.length > 0 && (
						<button
							type="button"
							onClick={selectAllDuplicates}
							className="rounded-lg bg-yellow-500 px-4 py-2 text-white transition-colors hover:bg-yellow-600"
						>
							Select All Duplicates
						</button>
					)}
			</div>

			{/* Content */}
			{viewMode === "all" ? (
				// All Faces View
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{!filteredFaces || filteredFaces.length === 0 ? (
						<div className="col-span-full py-12 text-center">
							<div className="mb-4 text-6xl">👤</div>
							<h2 className="mb-2 font-semibold text-2xl text-gray-700">
								{searchQuery ? "No faces found" : "No face encodings yet"}
							</h2>
							<p className="text-gray-600">
								{searchQuery
									? `No faces match your search: "${searchQuery}"`
									: "Face encodings will appear here after processing photos"}
							</p>
						</div>
					) : (
						filteredFaces.map((face) => (
							<FaceCard
								key={face.id}
								face={face}
								isSelected={selectedFaceIds.includes(face.id)}
								onToggleSelect={() => toggleFaceSelection(face.id)}
								onDelete={() =>
									handleDeleteFace(
										face.id,
										face.person?.name || "Unknown",
										face.totalInstances,
									)
								}
								isDeleting={deleteFaceMutation.isPending}
								isExpanded={expandedFaceId === face.id}
								onToggleExpanded={() =>
									setExpandedFaceId(expandedFaceId === face.id ? null : face.id)
								}
							/>
						))
					)}
				</div>
			) : (
				// Duplicates View
				<div className="space-y-6">
					{!duplicateGroups || duplicateGroups.length === 0 ? (
						<div className="py-12 text-center">
							<div className="mb-4 text-6xl">✨</div>
							<h2 className="mb-2 font-semibold text-2xl text-gray-700">
								No duplicates found
							</h2>
							<p className="text-gray-600">
								All people have only one face encoding each
							</p>
						</div>
					) : (
						duplicateGroups.map((group) => (
							<DuplicateGroup
								key={group.person?.id}
								group={group}
								selectedFaceIds={selectedFaceIds}
								onToggleSelect={toggleFaceSelection}
								onDelete={handleDeleteFace}
								isDeleting={deleteFaceMutation.isPending}
							/>
						))
					)}
				</div>
			)}

			{/* Statistics */}
			{allFaceEncodings && allFaceEncodings.length > 0 && (
				<div className="mt-12 rounded-lg bg-white p-6 shadow-lg">
					<h2 className="mb-4 font-semibold text-xl">Statistics</h2>
					<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
						<div className="text-center">
							<div className="font-bold text-2xl text-blue-600">
								{allFaceEncodings.length}
							</div>
							<div className="text-gray-600 text-sm">Total Face Encodings</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-green-600">
								{new Set(allFaceEncodings.map((f) => f.personId)).size}
							</div>
							<div className="text-gray-600 text-sm">Unique People</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-yellow-600">
								{duplicateGroups?.length || 0}
							</div>
							<div className="text-gray-600 text-sm">
								People with Duplicates
							</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-red-600">
								{duplicateGroups?.reduce(
									(sum, group) => sum + (group.encodings.length - 1),
									0,
								) || 0}
							</div>
							<div className="text-gray-600 text-sm">Extra Face Encodings</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// Face Card Component
function FaceCard({
	face,
	isSelected,
	onToggleSelect,
	onDelete,
	isDeleting,
	isExpanded,
	onToggleExpanded,
}: {
	face: FaceEncoding;
	isSelected: boolean;
	onToggleSelect: () => void;
	onDelete: () => void;
	isDeleting: boolean;
	isExpanded: boolean;
	onToggleExpanded: () => void;
}) {
	return (
		<div
			className={`rounded-lg bg-white p-4 shadow-lg transition-all ${
				isSelected ? "ring-2 ring-blue-500" : ""
			}`}
		>
			{/* Selection Checkbox */}
			<div className="mb-3 flex items-center justify-between">
				<input
					type="checkbox"
					checked={isSelected}
					onChange={onToggleSelect}
					className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
				/>
				<span className="text-gray-500 text-xs">ID: {face.id}</span>
			</div>

			{/* Face Preview */}
			<div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center">
				{face.bestPhotoFace?.photo?.s3Key && face.bestPhotoFace?.boundingBox ? (
					<FacePreview
						imageUrl={`/api/image-proxy?key=${encodeURIComponent(face.bestPhotoFace.photo.s3Key)}`}
						boundingBox={face.bestPhotoFace.boundingBox as BoundingBox}
						size={96}
						className="rounded-full"
						alt={`Face of ${face.person?.name || "Unknown"}`}
					/>
				) : (
					<div className="flex h-24 w-24 items-center justify-center rounded-full bg-gray-200">
						<span className="text-2xl">👤</span>
					</div>
				)}
			</div>

			{/* Face Info */}
			<div className="text-center">
				<h3 className="mb-2 font-semibold text-gray-900">
					{face.person?.name || "Unknown"}
				</h3>

				<div className="mb-4 space-y-1 text-gray-600 text-sm">
					<p>Confidence: {face.confidence?.toFixed(1)}%</p>
					<p>AWS Face ID: {face.awsFaceId.slice(0, 8)}...</p>
					<p>Instances: {face.totalInstances || 0} photos</p>
					<p>
						Added:{" "}
						{face.createdAt
							? new Date(face.createdAt).toLocaleDateString()
							: "Unknown"}
					</p>
				</div>

				{/* Actions */}
				<div className="space-y-2">
					{face.totalInstances > 1 && (
						<button
							type="button"
							onClick={onToggleExpanded}
							className="w-full rounded bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600"
						>
							{isExpanded ? "Hide" : "Show"} All Instances (
							{face.totalInstances})
						</button>
					)}
					<button
						type="button"
						onClick={onDelete}
						disabled={isDeleting}
						className="w-full rounded bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:bg-gray-400"
					>
						{isDeleting ? "Deleting..." : "Delete"}
					</button>
				</div>
			</div>

			{/* Expanded Instances View */}
			{isExpanded &&
				face.associatedPhotoFaces &&
				face.associatedPhotoFaces.length > 0 && (
					<div className="mt-4 border-gray-200 border-t pt-4">
						<h4 className="mb-3 font-medium text-gray-700 text-sm">
							All Instances ({face.associatedPhotoFaces.length})
						</h4>
						<div className="grid grid-cols-2 gap-3">
							{face.associatedPhotoFaces.map(
								(photoFace: PhotoFace, index: number) => (
									<div
										key={photoFace.id}
										className="flex flex-col items-center space-y-2"
									>
										{photoFace.photo?.s3Key && photoFace.boundingBox ? (
											<FacePreview
												imageUrl={`/api/image-proxy?key=${encodeURIComponent(photoFace.photo.s3Key)}`}
												boundingBox={photoFace.boundingBox as BoundingBox}
												size={48}
												className="rounded"
												alt={`Instance ${index + 1}`}
											/>
										) : (
											<div className="flex h-12 w-12 items-center justify-center rounded bg-gray-200">
												<span className="text-sm">👤</span>
											</div>
										)}
										<div className="text-center text-gray-600 text-xs">
											<div>{photoFace.confidence?.toFixed(1)}%</div>
											<div>{photoFace.photo?.filename || "Unknown"}</div>
										</div>
									</div>
								),
							)}
						</div>
					</div>
				)}
		</div>
	);
}

// Duplicate Group Component
function DuplicateGroup({
	group,
	selectedFaceIds,
	onToggleSelect,
	onDelete,
	isDeleting,
}: {
	group: DuplicateGroup;
	selectedFaceIds: number[];
	onToggleSelect: (faceId: number) => void;
	onDelete: (
		faceId: number,
		personName: string,
		totalInstances?: number,
	) => void;
	isDeleting: boolean;
}) {
	// Sort by confidence descending (highest first)
	const sortedEncodings = group.encodings.sort(
		(a: FaceEncoding, b: FaceEncoding) =>
			(b.confidence || 0) - (a.confidence || 0),
	);

	return (
		<div className="rounded-lg bg-white p-6 shadow-lg">
			<div className="mb-4 flex items-center justify-between">
				<h3 className="font-semibold text-lg">
					{group.person?.name || "Unknown"} ({group.encodings.length} encodings)
				</h3>
				<div className="text-gray-600 text-sm">
					{group.encodings.length - 1} duplicate
					{group.encodings.length > 2 ? "s" : ""}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-4">
				{sortedEncodings.map((face: FaceEncoding, index: number) => (
					<div
						key={face.id}
						className={`rounded-lg border p-4 ${
							index === 0 ? "border-green-500 bg-green-50" : "border-gray-200"
						} ${selectedFaceIds.includes(face.id) ? "ring-2 ring-blue-500" : ""}`}
					>
						{/* Badge for best face */}
						{index === 0 && (
							<div className="mb-2 text-center">
								<span className="rounded-full bg-green-500 px-2 py-1 text-white text-xs">
									Best
								</span>
							</div>
						)}

						{/* Selection Checkbox (disabled for best face) */}
						<div className="mb-3 flex items-center justify-between">
							<input
								type="checkbox"
								checked={selectedFaceIds.includes(face.id)}
								onChange={() => onToggleSelect(face.id)}
								disabled={index === 0} // Don't allow selecting the best face
								className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
							/>
							<span className="text-gray-500 text-xs">#{index + 1}</span>
						</div>

						{/* Face Preview */}
						<div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center">
							{face.bestPhotoFace?.photo?.s3Key &&
							face.bestPhotoFace?.boundingBox ? (
								<FacePreview
									imageUrl={`/api/image-proxy?key=${encodeURIComponent(face.bestPhotoFace.photo.s3Key)}`}
									boundingBox={face.bestPhotoFace.boundingBox as BoundingBox}
									size={64}
									className="rounded-full"
									alt={`Face ${index + 1} of ${group.person?.name || "Unknown"}`}
								/>
							) : (
								<div className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-200">
									<span className="text-lg">👤</span>
								</div>
							)}
						</div>

						{/* Face Info */}
						<div className="text-center text-sm">
							<p className="font-medium">
								Confidence: {face.confidence?.toFixed(1)}%
							</p>
							<p className="text-gray-600">
								{face.totalInstances || 0} instances
							</p>
							<p className="text-gray-600">
								{face.createdAt
									? new Date(face.createdAt).toLocaleDateString()
									: "Unknown"}
							</p>
						</div>

						{/* Delete Button (disabled for best face) */}
						{index > 0 && (
							<button
								type="button"
								onClick={() =>
									onDelete(
										face.id,
										group.person?.name || "Unknown",
										face.totalInstances,
									)
								}
								disabled={isDeleting}
								className="mt-3 w-full rounded bg-red-500 px-2 py-1 text-white text-xs transition-colors hover:bg-red-600 disabled:bg-gray-400"
							>
								{isDeleting ? "..." : "Delete"}
							</button>
						)}
					</div>
				))}
			</div>
		</div>
	);
}
