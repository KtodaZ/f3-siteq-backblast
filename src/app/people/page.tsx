"use client";

import Link from "next/link";
import { useState } from "react";
import FacePreview from "~/app/_components/FacePreview";
import { api } from "~/trpc/react";

// Type definitions for people data
interface BoundingBox {
	left: number;
	top: number;
	width: number;
	height: number;
}

interface Person {
	id: number;
	name: string;
	createdAt: Date | null;
}

interface Photo {
	id: number;
	filename: string;
	s3Key: string;
}

interface PhotoFace {
	id: number;
	confidence: number | null;
	boundingBox: BoundingBox | null;
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
	bestPhotoFace: PhotoFace | null;
	associatedPhotoFaces: PhotoFace[];
}

interface PersonWithFaces extends Person {
	bestPhotoFace: PhotoFace | null;
	faceEncodingsCount: number;
}

interface DuplicateGroup {
	person: Person | null;
	encodings: FaceEncoding[];
}

interface DeletePersonMutation {
	isPending: boolean;
	mutateAsync: (variables: { id: number }) => Promise<unknown>;
}

export default function PeoplePage() {
	const [isAddingPerson, setIsAddingPerson] = useState(false);
	const [newPersonName, setNewPersonName] = useState("");
	const [searchQuery, setSearchQuery] = useState("");
	const [activeTab, setActiveTab] = useState<
		"people" | "duplicates" | "encodings"
	>("people");
	const [selectedFaceIds, setSelectedFaceIds] = useState<number[]>([]);
	const [expandedFaceId, setExpandedFaceId] = useState<number | null>(null);

	const {
		data: people,
		isLoading,
		error,
	} = api.people.getAll.useQuery({
		limit: 100,
		offset: 0,
	});

	const utils = api.useUtils();

	const createPersonMutation = api.people.create.useMutation({
		onSuccess: () => {
			setIsAddingPerson(false);
			setNewPersonName("");
			// Refresh the people list
			utils.people.getAll.invalidate();
		},
	});

	const deletePersonMutation = api.people.delete.useMutation({
		onSuccess: (result, variables) => {
			// Invalidate all people-related queries
			utils.people.getAll.invalidate();
			utils.people.search.invalidate();
			utils.people.getById.invalidate({ id: variables.id });

			// Since person was deleted and photoFaces were updated, invalidate photo queries
			// This ensures results pages show updated face data (faces become "Unknown")
			utils.photo.getFaces.invalidate();

			// Also invalidate face-related queries since face encodings were deleted
			utils.faces.getAll.invalidate();
			utils.faces.findDuplicates.invalidate();
		},
	});

	const { data: searchResults } = api.people.search.useQuery(
		{ query: searchQuery },
		{ enabled: searchQuery.length > 0 },
	);

	// Face management queries
	const {
		data: allFaceEncodings,
		isLoading: isLoadingFaces,
		refetch: refetchFaces,
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

	const handleAddPerson = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!newPersonName.trim()) return;

		await createPersonMutation.mutateAsync({
			name: newPersonName.trim(),
		});
	};

	const handleDeletePerson = async (id: number, name: string) => {
		if (
			confirm(
				`Are you sure you want to delete "${name}"? This will remove all associated face data.`,
			)
		) {
			await deletePersonMutation.mutateAsync({ id });
		}
	};

	// Face management functions
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

	const displayPeople = searchQuery ? searchResults : people;

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
					<p className="mt-4 text-gray-600">Loading people...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center text-red-600">
					<p>Failed to load people. Please try again.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto px-4 py-8">
			<div className="mb-8 flex items-center justify-between">
				<h1 className="font-bold text-3xl">People Management</h1>
				<div className="flex space-x-3">
					{selectedFaceIds.length > 0 && activeTab !== "people" && (
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
					{activeTab === "people" && (
						<button
							type="button"
							onClick={() => setIsAddingPerson(true)}
							className="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
						>
							Add Person
						</button>
					)}
				</div>
			</div>

			{/* Tab Navigation */}
			<div className="mb-6 flex rounded-lg bg-gray-200 p-1">
				<button
					type="button"
					onClick={() => setActiveTab("people")}
					className={`rounded-md px-4 py-2 font-medium text-sm transition-colors ${
						activeTab === "people"
							? "bg-white text-blue-600 shadow"
							: "text-gray-600 hover:text-gray-900"
					}`}
				>
					People ({displayPeople?.length || 0})
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("duplicates")}
					className={`rounded-md px-4 py-2 font-medium text-sm transition-colors ${
						activeTab === "duplicates"
							? "bg-white text-blue-600 shadow"
							: "text-gray-600 hover:text-gray-900"
					}`}
				>
					Duplicates ({duplicateGroups?.length || 0})
				</button>
				<button
					type="button"
					onClick={() => setActiveTab("encodings")}
					className={`rounded-md px-4 py-2 font-medium text-sm transition-colors ${
						activeTab === "encodings"
							? "bg-white text-blue-600 shadow"
							: "text-gray-600 hover:text-gray-900"
					}`}
				>
					Face Encodings ({allFaceEncodings?.length || 0})
				</button>
			</div>

			{/* Search - only show for people tab */}
			{activeTab === "people" && (
				<div className="mb-6">
					<input
						type="text"
						placeholder="Search people..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="w-full max-w-md rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
			)}

			{/* Duplicates Controls */}
			{activeTab === "duplicates" &&
				duplicateGroups &&
				duplicateGroups.length > 0 && (
					<div className="mb-6">
						<button
							type="button"
							onClick={selectAllDuplicates}
							className="rounded-lg bg-yellow-500 px-4 py-2 text-white transition-colors hover:bg-yellow-600"
						>
							Select All Duplicates
						</button>
					</div>
				)}

			{/* Add Person Modal */}
			{isAddingPerson && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
					<div className="mx-4 w-full max-w-md rounded-lg bg-white p-6">
						<h2 className="mb-4 font-semibold text-xl">Add New Person</h2>
						<form onSubmit={handleAddPerson}>
							<input
								type="text"
								value={newPersonName}
								onChange={(e) => setNewPersonName(e.target.value)}
								placeholder="Enter person's name"
								className="mb-4 w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
							/>
							<div className="flex space-x-3">
								<button
									type="button"
									onClick={() => {
										setIsAddingPerson(false);
										setNewPersonName("");
									}}
									className="flex-1 rounded-lg bg-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-400"
								>
									Cancel
								</button>
								<button
									type="submit"
									disabled={
										!newPersonName.trim() || createPersonMutation.isPending
									}
									className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:bg-gray-400"
								>
									{createPersonMutation.isPending ? "Adding..." : "Add Person"}
								</button>
							</div>
						</form>
					</div>
				</div>
			)}

			{/* Tab Content */}
			{activeTab === "people" && (
				<PeopleTab
					displayPeople={displayPeople}
					searchQuery={searchQuery}
					setSearchQuery={setSearchQuery}
					setIsAddingPerson={setIsAddingPerson}
					handleDeletePerson={handleDeletePerson}
					deletePersonMutation={deletePersonMutation}
					setActiveTab={setActiveTab}
				/>
			)}

			{activeTab === "duplicates" && (
				<DuplicatesTab
					duplicateGroups={duplicateGroups}
					isLoadingDuplicates={isLoadingDuplicates}
					selectedFaceIds={selectedFaceIds}
					toggleFaceSelection={toggleFaceSelection}
					handleDeleteFace={handleDeleteFace}
					deleteFaceMutation={deleteFaceMutation}
				/>
			)}

			{activeTab === "encodings" && (
				<EncodingsTab
					allFaceEncodings={allFaceEncodings}
					isLoadingFaces={isLoadingFaces}
					selectedFaceIds={selectedFaceIds}
					toggleFaceSelection={toggleFaceSelection}
					handleDeleteFace={handleDeleteFace}
					deleteFaceMutation={deleteFaceMutation}
					expandedFaceId={expandedFaceId}
					setExpandedFaceId={setExpandedFaceId}
				/>
			)}

			{/* Statistics */}
			{displayPeople && displayPeople.length > 0 && !searchQuery && (
				<div className="mt-12 rounded-lg bg-white p-6 shadow-lg">
					<h2 className="mb-4 font-semibold text-xl">Statistics</h2>
					<div className="grid grid-cols-2 gap-4 md:grid-cols-3">
						<div className="text-center">
							<div className="font-bold text-2xl text-blue-600">
								{displayPeople.length}
							</div>
							<div className="text-gray-600 text-sm">Total People</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-green-600">
								{displayPeople.reduce(
									(sum, p) => sum + (p.faceEncodings?.length || 0),
									0,
								)}
							</div>
							<div className="text-gray-600 text-sm">Face Encodings</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-purple-600">
								{
									displayPeople.filter(
										(p) => (p.faceEncodings?.length || 0) > 0,
									).length
								}
							</div>
							<div className="text-gray-600 text-sm">With Face Data</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// People Tab Component
function PeopleTab({
	displayPeople,
	searchQuery,
	setSearchQuery,
	setIsAddingPerson,
	handleDeletePerson,
	deletePersonMutation,
	setActiveTab,
}: {
	displayPeople: PersonWithFaces[];
	searchQuery: string;
	setSearchQuery: (query: string) => void;
	setIsAddingPerson: (adding: boolean) => void;
	handleDeletePerson: (id: number, name: string) => void;
	deletePersonMutation: DeletePersonMutation;
	setActiveTab: (tab: "people" | "duplicates" | "encodings") => void;
}) {
	// People data is already enriched with bestPhotoFace from the API
	const enrichedPeople = displayPeople || [];

	if (!enrichedPeople || enrichedPeople.length === 0) {
		return (
			<div className="py-12 text-center">
				<div className="mb-4 text-6xl">👥</div>
				{searchQuery ? (
					<>
						<h2 className="mb-2 font-semibold text-2xl text-gray-700">
							No people found
						</h2>
						<p className="mb-6 text-gray-600">
							No people match your search: "{searchQuery}"
						</p>
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="text-blue-600 hover:text-blue-800"
						>
							Clear search
						</button>
					</>
				) : (
					<>
						<h2 className="mb-2 font-semibold text-2xl text-gray-700">
							No people yet
						</h2>
						<p className="mb-6 text-gray-600">
							Add people to start building your face recognition database
						</p>
						<button
							type="button"
							onClick={() => setIsAddingPerson(true)}
							className="rounded-lg bg-blue-500 px-6 py-3 text-white transition-colors hover:bg-blue-600"
						>
							Add First Person
						</button>
					</>
				)}
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{enrichedPeople.map((person: PersonWithFaces) => (
				<PersonCard
					key={person.id}
					person={person}
					onDelete={() => handleDeletePerson(person.id, person.name)}
					isDeleting={deletePersonMutation.isPending}
					setActiveTab={setActiveTab}
				/>
			))}
		</div>
	);
}

// Person Card Component with Face Preview
function PersonCard({
	person,
	onDelete,
	isDeleting,
	setActiveTab,
}: {
	person: PersonWithFaces;
	onDelete: () => void;
	isDeleting: boolean;
	setActiveTab: (tab: "people" | "duplicates" | "encodings") => void;
}) {
	return (
		<div className="rounded-lg bg-white p-6 shadow-lg">
			{/* Person Avatar with Best Face */}
			<div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center">
				{person.bestPhotoFace?.photo?.s3Key &&
				person.bestPhotoFace?.boundingBox ? (
					<FacePreview
						imageUrl={`/api/image-proxy?key=${encodeURIComponent(person.bestPhotoFace.photo.s3Key)}`}
						boundingBox={person.bestPhotoFace.boundingBox}
						size={80}
						className="rounded-full"
						alt={`${person.name}'s face`}
					/>
				) : (
					<div className="flex h-20 w-20 items-center justify-center rounded-full bg-gray-200">
						<span className="text-2xl">👤</span>
					</div>
				)}
			</div>

			{/* Person Info */}
			<div className="text-center">
				<h3 className="mb-2 font-semibold text-gray-900 text-lg">
					{person.name}
				</h3>

				<div className="mb-4 space-y-2">
					<div className="space-y-1 text-gray-600 text-sm">
						<p>Face encodings: {person.faceEncodings?.length || 0}</p>
						<p>
							Added:{" "}
							{person.createdAt
								? new Date(person.createdAt).toLocaleDateString()
								: "Unknown"}
						</p>
					</div>

					{/* Training Status Badge */}
					<div className="flex justify-center">
						{(person.faceEncodings?.length || 0) >= 10 ? (
							<span className="rounded-full bg-green-100 px-2 py-1 text-green-800 text-xs">
								✅ Excellent
							</span>
						) : (person.faceEncodings?.length || 0) >= 5 ? (
							<span className="rounded-full bg-yellow-100 px-2 py-1 text-xs text-yellow-800">
								⚠️ Good
							</span>
						) : (person.faceEncodings?.length || 0) >= 1 ? (
							<span className="rounded-full bg-orange-100 px-2 py-1 text-orange-800 text-xs">
								🔶 Needs More
							</span>
						) : (
							<span className="rounded-full bg-red-100 px-2 py-1 text-red-800 text-xs">
								❌ No Data
							</span>
						)}
					</div>
				</div>

				{/* Action Buttons */}
				<div className="grid grid-cols-2 gap-2">
					<div className="col-span-2 flex space-x-2">
						<Link
							href={`/person/${person.id}`}
							className="flex-1 rounded bg-green-500 px-3 py-2 text-center text-sm text-white transition-colors hover:bg-green-600"
						>
							View Details
						</Link>
						<button
							type="button"
							onClick={() => setActiveTab("duplicates")}
							className="flex-1 rounded bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600"
						>
							Manage Faces
						</button>
					</div>
					<button
						type="button"
						onClick={onDelete}
						disabled={isDeleting}
						className="col-span-2 rounded bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:bg-gray-400"
					>
						{isDeleting ? "..." : "Delete Person"}
					</button>
				</div>
			</div>
		</div>
	);
}

// Duplicates Tab Component (moved from faces page)
function DuplicatesTab({
	duplicateGroups,
	isLoadingDuplicates,
	selectedFaceIds,
	toggleFaceSelection,
	handleDeleteFace,
	deleteFaceMutation,
}: {
	duplicateGroups: DuplicateGroup[];
	isLoadingDuplicates: boolean;
	selectedFaceIds: number[];
	toggleFaceSelection: (faceId: number) => void;
	handleDeleteFace: (
		faceId: number,
		personName: string,
		totalInstances?: number,
	) => void;
	deleteFaceMutation: { isPending: boolean };
}) {
	if (isLoadingDuplicates) {
		return (
			<div className="text-center">
				<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
				<p className="mt-4 text-gray-600">Loading duplicates...</p>
			</div>
		);
	}

	if (!duplicateGroups || duplicateGroups.length === 0) {
		return (
			<div className="py-12 text-center">
				<div className="mb-4 text-6xl">✨</div>
				<h2 className="mb-2 font-semibold text-2xl text-gray-700">
					No duplicates found
				</h2>
				<p className="text-gray-600">
					All people have only one face encoding each
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{duplicateGroups.map((group: DuplicateGroup) => (
				<DuplicateGroup
					key={group.person?.id}
					group={group}
					selectedFaceIds={selectedFaceIds}
					onToggleSelect={toggleFaceSelection}
					onDelete={handleDeleteFace}
					isDeleting={deleteFaceMutation.isPending}
				/>
			))}
		</div>
	);
}

// Encodings Tab Component (moved from faces page)
function EncodingsTab({
	allFaceEncodings,
	isLoadingFaces,
	selectedFaceIds,
	toggleFaceSelection,
	handleDeleteFace,
	deleteFaceMutation,
	expandedFaceId,
	setExpandedFaceId,
}: {
	allFaceEncodings: FaceEncoding[];
	isLoadingFaces: boolean;
	selectedFaceIds: number[];
	toggleFaceSelection: (faceId: number) => void;
	handleDeleteFace: (
		faceId: number,
		personName: string,
		totalInstances?: number,
	) => void;
	deleteFaceMutation: { isPending: boolean };
	expandedFaceId: number | null;
	setExpandedFaceId: (id: number | null) => void;
}) {
	if (isLoadingFaces) {
		return (
			<div className="text-center">
				<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
				<p className="mt-4 text-gray-600">Loading face encodings...</p>
			</div>
		);
	}

	if (!allFaceEncodings || allFaceEncodings.length === 0) {
		return (
			<div className="py-12 text-center">
				<div className="mb-4 text-6xl">👤</div>
				<h2 className="mb-2 font-semibold text-2xl text-gray-700">
					No face encodings yet
				</h2>
				<p className="text-gray-600">
					Face encodings will appear here after processing photos
				</p>
			</div>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
			{allFaceEncodings.map((face: FaceEncoding) => (
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
			))}
		</div>
	);
}

// Face Card Component (copied from faces page)
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
						boundingBox={face.bestPhotoFace.boundingBox}
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
												boundingBox={photoFace.boundingBox}
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

// Duplicate Group Component (copied from faces page)
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
									boundingBox={face.bestPhotoFace.boundingBox}
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
