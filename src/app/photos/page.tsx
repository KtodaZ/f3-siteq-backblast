"use client";

import Link from "next/link";
import PhotoImage from "~/app/_components/PhotoImage";
import { api } from "~/trpc/react";

export default function PhotosPage() {
	const {
		data: photos,
		isLoading,
		error,
	} = api.photo.getAll.useQuery(
		{
			limit: 50,
			offset: 0,
		},
		{
			// Simple polling for now - will fix the smart polling logic later
			refetchInterval: 5000, // Poll every 5 seconds
			refetchOnWindowFocus: true, // Refresh when user comes back to tab
		},
	);

	const utils = api.useUtils();

	const deletePhotoMutation = api.photo.delete.useMutation({
		onSuccess: (result, variables) => {
			// Invalidate all photo-related queries
			utils.photo.getAll.invalidate();
			utils.photo.getById.invalidate({ id: variables.id });
			utils.photo.getFaces.invalidate({ photoId: variables.id });
			utils.photo.getPresignedUrl.invalidate({ photoId: variables.id });

			// Since faces were deleted, also invalidate people queries that show face counts
			utils.people.getAll.invalidate();
		},
	});

	const handleDeletePhoto = async (id: number, filename: string) => {
		if (confirm(`Are you sure you want to delete "${filename}"?`)) {
			await deletePhotoMutation.mutateAsync({ id });
		}
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case "completed":
				return "bg-green-100 text-green-800";
			case "processing":
				return "bg-blue-100 text-blue-800";
			case "failed":
				return "bg-red-100 text-red-800";
			default:
				return "bg-yellow-100 text-yellow-800";
		}
	};

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return "✅";
			case "processing":
				return "⏳";
			case "failed":
				return "❌";
			default:
				return "⏸️";
		}
	};

	if (isLoading) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center">
					<div className="mx-auto h-12 w-12 animate-spin rounded-full border-blue-500 border-b-2" />
					<p className="mt-4 text-gray-600">Loading photos...</p>
				</div>
			</div>
		);
	}

	if (error) {
		return (
			<div className="container mx-auto px-4 py-8">
				<div className="text-center text-red-600">
					<p>Failed to load photos. Please try again.</p>
				</div>
			</div>
		);
	}

	return (
		<div className="container mx-auto px-4 py-8">
			<div className="mb-8 flex items-center justify-between">
				<h1 className="font-bold text-3xl">Photo Gallery</h1>
				<Link
					href="/upload"
					className="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
				>
					Upload New Photos
				</Link>
			</div>

			{!photos || photos.length === 0 ? (
				<div className="py-12 text-center">
					<div className="mb-4 text-6xl">📸</div>
					<h2 className="mb-2 font-semibold text-2xl text-gray-700">
						No photos yet
					</h2>
					<p className="mb-6 text-gray-600">
						Upload your first photo to get started with face recognition
					</p>
					<Link
						href="/upload"
						className="rounded-lg bg-blue-500 px-6 py-3 text-white transition-colors hover:bg-blue-600"
					>
						Upload Photos
					</Link>
				</div>
			) : (
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{photos.map((photo) => (
						<div
							key={photo.id}
							className="overflow-hidden rounded-lg bg-white shadow-lg"
						>
							{/* Photo display */}
							<div className="h-48 overflow-hidden bg-gray-200">
								<PhotoImage
									photoId={photo.id}
									filename={photo.filename}
									alt={photo.filename}
									className="h-full w-full object-cover"
								/>
							</div>

							{/* Photo info */}
							<div className="p-4">
								<h3
									className="mb-2 truncate font-semibold text-gray-900"
									title={photo.filename}
								>
									{photo.filename}
								</h3>

								<div className="space-y-2 text-sm">
									<div className="flex items-center justify-between">
										<span className="text-gray-600">Status:</span>
										<span
											className={`rounded-full px-2 py-1 font-medium text-xs ${getStatusColor(photo.processingStatus || "pending")}`}
										>
											{getStatusIcon(photo.processingStatus || "pending")}{" "}
											{photo.processingStatus || "pending"}
										</span>
									</div>

									<div className="flex items-center justify-between">
										<span className="text-gray-600">Faces:</span>
										<span className="font-medium">
											{photo.taggedFaceCount}/{photo.faceCount || 0}
										</span>
									</div>

									<div className="flex items-center justify-between">
										<span className="text-gray-600">Uploaded:</span>
										<span className="font-medium">
											{photo.uploadDate
												? new Date(photo.uploadDate).toLocaleDateString()
												: "Unknown"}
										</span>
									</div>
								</div>

								{/* Action buttons */}
								<div className="mt-4 flex space-x-2">
									<Link
										href={`/results/${photo.id}`}
										className="flex-1 rounded bg-blue-500 px-3 py-2 text-center text-sm text-white transition-colors hover:bg-blue-600"
									>
										View Results
									</Link>
									<button
										type="button"
										onClick={() => handleDeletePhoto(photo.id, photo.filename)}
										disabled={deletePhotoMutation.isPending}
										className="rounded bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:bg-gray-400"
									>
										{deletePhotoMutation.isPending ? "..." : "🗑️"}
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Statistics */}
			{photos && photos.length > 0 && (
				<div className="mt-12 rounded-lg bg-white p-6 shadow-lg">
					<h2 className="mb-4 font-semibold text-xl">Statistics</h2>
					<div className="grid grid-cols-2 gap-4 md:grid-cols-4">
						<div className="text-center">
							<div className="font-bold text-2xl text-blue-600">
								{photos.length}
							</div>
							<div className="text-gray-600 text-sm">Total Photos</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-green-600">
								{
									photos.filter((p) => p.processingStatus === "completed")
										.length
								}
							</div>
							<div className="text-gray-600 text-sm">Processed</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-yellow-600">
								{
									photos.filter(
										(p) =>
											p.processingStatus === "pending" ||
											p.processingStatus === "processing",
									).length
								}
							</div>
							<div className="text-gray-600 text-sm">Processing</div>
						</div>
						<div className="text-center">
							<div className="font-bold text-2xl text-purple-600">
								{photos.reduce((sum, p) => sum + (p.taggedFaceCount || 0), 0)}/
								{photos.reduce((sum, p) => sum + (p.faceCount || 0), 0)}
							</div>
							<div className="text-gray-600 text-sm">Tagged/Total Faces</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
