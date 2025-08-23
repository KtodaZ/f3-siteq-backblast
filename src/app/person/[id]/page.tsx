"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "~/trpc/react";

export default function PersonDetailPage() {
	const params = useParams();
	const router = useRouter();
	const personId = Number(params.id);
	const [isEditing, setIsEditing] = useState(false);
	const [editName, setEditName] = useState("");

	const {
		data: person,
		isLoading: personLoading,
		error: personError,
	} = api.people.getById.useQuery(
		{ id: personId },
		{ enabled: !Number.isNaN(personId) },
	);

	const utils = api.useUtils();
	const updatePersonMutation = api.people.update.useMutation({
		onSuccess: () => {
			setIsEditing(false);
			// Invalidate all people queries that might show the person's name
			utils.people.getById.invalidate({ id: personId });
			utils.people.getAll.invalidate(); // Update people list with new name
			utils.people.search.invalidate(); // Update search results

			// Also invalidate photo faces queries since they show person names
			utils.photo.getFaces.invalidate();
		},
	});
	const deletePersonMutation = api.people.delete.useMutation({
		onSuccess: (result, variables) => {
			// Invalidate all people-related queries
			utils.people.getAll.invalidate();
			utils.people.search.invalidate();
			utils.people.getById.invalidate({ id: variables.id });

			// Since person was deleted and photoFaces were updated, invalidate photo queries
			utils.photo.getFaces.invalidate();

			// Also invalidate face-related queries since face encodings were deleted
			utils.faces.getAll.invalidate();
			utils.faces.findDuplicates.invalidate();

			// Navigate back to people page
			router.push("/people");
		},
	});

	const handleSaveName = async () => {
		if (!editName.trim()) return;
		await updatePersonMutation.mutateAsync({
			id: personId,
			name: editName.trim(),
		});
	};

	const handleDeletePerson = async () => {
		if (
			confirm(
				`Are you sure you want to delete "${person?.name}"? This will remove all face assignments and cannot be undone.`,
			)
		) {
			await deletePersonMutation.mutateAsync({ id: personId });
		}
	};

	const startEditing = () => {
		setEditName(person?.name || "");
		setIsEditing(true);
	};

	if (Number.isNaN(personId)) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="font-bold text-2xl text-red-600">Invalid Person ID</h1>
				<Link
					href="/people"
					className="mt-4 inline-block rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
				>
					Back to People
				</Link>
			</div>
		);
	}

	if (personLoading) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
				<p className="mt-4 text-gray-600">Loading person details...</p>
			</div>
		);
	}

	if (personError || !person) {
		return (
			<div className="container mx-auto px-4 py-8 text-center">
				<h1 className="font-bold text-2xl text-red-600">Person Not Found</h1>
				<p className="mt-2 text-gray-600">
					The requested person could not be found.
				</p>
				<Link
					href="/people"
					className="mt-4 inline-block rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
				>
					Back to People
				</Link>
			</div>
		);
	}

	const trainingFaceCount = person.faceEncodings?.length || 0;
	const photoAppearances = person.photoFaces?.length || 0;
	const uniquePhotos = new Set(person.photoFaces?.map((pf) => pf.photo?.id))
		.size;

	return (
		<div className="container mx-auto max-w-6xl px-4 py-8">
			<div className="mb-6">
				<Link
					href="/people"
					className="font-medium text-blue-600 hover:text-blue-800"
				>
					← Back to People
				</Link>
			</div>

			{/* Person Header */}
			<div className="mb-8 rounded-lg bg-white p-6 shadow-lg">
				<div className="flex items-start justify-between">
					<div className="flex-1">
						{isEditing ? (
							<div className="flex items-center space-x-3">
								<input
									type="text"
									value={editName}
									onChange={(e) => setEditName(e.target.value)}
									className="rounded border px-3 py-2 font-bold text-2xl focus:outline-none focus:ring-2 focus:ring-blue-500"
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleSaveName();
										} else if (e.key === "Escape") {
											setIsEditing(false);
										}
									}}
								/>
								<button
									type="button"
									onClick={handleSaveName}
									disabled={!editName.trim() || updatePersonMutation.isPending}
									className="rounded bg-green-500 px-3 py-2 text-white hover:bg-green-600 disabled:bg-gray-400"
								>
									{updatePersonMutation.isPending ? "..." : "Save"}
								</button>
								<button
									type="button"
									onClick={() => setIsEditing(false)}
									className="rounded bg-gray-500 px-3 py-2 text-white hover:bg-gray-600"
								>
									Cancel
								</button>
							</div>
						) : (
							<div className="flex items-center space-x-3">
								<h1 className="font-bold text-3xl">{person.name}</h1>
								<button
									type="button"
									onClick={startEditing}
									className="rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
								>
									Edit Name
								</button>
							</div>
						)}

						<div className="mt-4 grid grid-cols-3 gap-4 text-center">
							<div>
								<div className="font-bold text-2xl text-blue-600">
									{trainingFaceCount}
								</div>
								<div className="text-gray-600 text-sm">Training Faces</div>
							</div>
							<div>
								<div className="font-bold text-2xl text-green-600">
									{photoAppearances}
								</div>
								<div className="text-gray-600 text-sm">Total Appearances</div>
							</div>
							<div>
								<div className="font-bold text-2xl text-purple-600">
									{uniquePhotos}
								</div>
								<div className="text-gray-600 text-sm">Photos Found In</div>
							</div>
						</div>

						{/* Training Status */}
						<div className="mt-4">
							<div className="flex items-center space-x-2">
								<span className="font-medium">Training Status:</span>
								{trainingFaceCount >= 10 ? (
									<span className="rounded-full bg-green-100 px-3 py-1 text-green-800 text-sm">
										✅ Excellent ({trainingFaceCount} faces)
									</span>
								) : trainingFaceCount >= 5 ? (
									<span className="rounded-full bg-yellow-100 px-3 py-1 text-sm text-yellow-800">
										⚠️ Good ({trainingFaceCount} faces)
									</span>
								) : trainingFaceCount >= 1 ? (
									<span className="rounded-full bg-orange-100 px-3 py-1 text-orange-800 text-sm">
										🔶 Needs More ({trainingFaceCount} faces)
									</span>
								) : (
									<span className="rounded-full bg-red-100 px-3 py-1 text-red-800 text-sm">
										❌ No Training Data
									</span>
								)}
							</div>
							{trainingFaceCount < 10 && (
								<p className="mt-1 text-gray-600 text-sm">
									{trainingFaceCount < 5
										? "Add more face assignments to improve recognition accuracy. Recommended: 5-10 faces minimum."
										: "Good recognition quality. Adding more faces will improve accuracy further."}
								</p>
							)}
						</div>
					</div>

					<div className="flex space-x-2">
						<button
							type="button"
							onClick={handleDeletePerson}
							disabled={deletePersonMutation.isPending}
							className="rounded bg-red-500 px-4 py-2 text-white hover:bg-red-600 disabled:bg-gray-400"
						>
							{deletePersonMutation.isPending ? "..." : "Delete Person"}
						</button>
					</div>
				</div>
			</div>

			{/* Photo Appearances */}
			<div className="rounded-lg bg-white p-6 shadow-lg">
				<h2 className="mb-4 font-semibold text-xl">Photo Appearances</h2>

				{person.photoFaces && person.photoFaces.length > 0 ? (
					<div className="space-y-4">
						{person.photoFaces.map((photoFace, index) => (
							<div
								key={photoFace.id}
								className="flex items-center space-x-4 rounded-lg border p-4 hover:bg-gray-50"
							>
								{/* Face Preview - Simplified for now */}
								<div className="flex-shrink-0">
									<div
										className="flex items-center justify-center rounded border-2 border-gray-200 bg-gray-200"
										style={{ width: 80, height: 80 }}
									>
										👤
									</div>
								</div>

								{/* Photo Info */}
								<div className="flex-1">
									<h3 className="font-medium">
										{photoFace.photo?.filename || "Unknown Photo"}
									</h3>
									<div className="space-y-2 text-sm">
										<div className="flex items-center space-x-2">
											<span className="text-gray-600">Confidence:</span>
											{photoFace.confidence ? (
												<span
													className={`rounded px-2 py-1 font-medium text-xs ${
														photoFace.confidence >= 85
															? "bg-green-100 text-green-800"
															: photoFace.confidence >= 70
																? "bg-yellow-100 text-yellow-800"
																: "bg-red-100 text-red-800"
													}`}
												>
													{photoFace.confidence.toFixed(1)}%
													{photoFace.confidence >= 85
														? " 🌟"
														: photoFace.confidence >= 70
															? " ⚠️"
															: " 🔍"}
												</span>
											) : (
												<span className="text-gray-500">N/A</span>
											)}
										</div>
										<div className="flex items-center space-x-2">
											<span className="text-gray-600">Status:</span>
											<span
												className={`inline-block rounded px-2 py-1 text-xs ${
													photoFace.isConfirmed
														? "bg-green-100 text-green-800"
														: "bg-yellow-100 text-yellow-800"
												}`}
											>
												{photoFace.isConfirmed
													? "✅ Confirmed"
													: "⏳ Needs Review"}
											</span>
											{photoFace.confidence && photoFace.confidence < 70 && (
												<span className="rounded bg-orange-100 px-2 py-1 text-orange-800 text-xs">
													🔍 Low Quality
												</span>
											)}
										</div>
										<p className="text-gray-600">
											Upload Date:{" "}
											{photoFace.photo?.uploadDate
												? new Date(
														photoFace.photo.uploadDate,
													).toLocaleDateString()
												: "Unknown"}
										</p>
									</div>
								</div>

								{/* Actions */}
								<div className="flex space-x-2">
									<Link
										href={`/results/${photoFace.photo?.id}`}
										className="rounded bg-blue-500 px-3 py-2 text-sm text-white hover:bg-blue-600"
									>
										View Photo
									</Link>
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="py-8 text-center text-gray-600">
						<p>No photo appearances found for this person.</p>
						<p className="mt-2 text-sm">
							This person may have been created manually but not yet assigned to
							any faces in photos.
						</p>
					</div>
				)}
			</div>
		</div>
	);
}
