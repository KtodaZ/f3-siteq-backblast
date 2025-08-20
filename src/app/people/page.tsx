"use client";

import { useState } from "react";
import { api } from "~/trpc/react";

export default function PeoplePage() {
	const [isAddingPerson, setIsAddingPerson] = useState(false);
	const [newPersonName, setNewPersonName] = useState("");
	const [searchQuery, setSearchQuery] = useState("");

	const {
		data: people,
		isLoading,
		error,
	} = api.people.getAll.useQuery({
		limit: 100,
		offset: 0,
	});

	const createPersonMutation = api.people.create.useMutation({
		onSuccess: () => {
			setIsAddingPerson(false);
			setNewPersonName("");
			// Refresh the people list
			window.location.reload();
		},
	});

	const deletePersonMutation = api.people.delete.useMutation({
		onSuccess: () => {
			// Refresh the people list
			window.location.reload();
		},
	});

	const { data: searchResults } = api.people.search.useQuery(
		{ query: searchQuery },
		{ enabled: searchQuery.length > 0 },
	);

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
				<h1 className="font-bold text-3xl">People Directory</h1>
				<button
					onClick={() => setIsAddingPerson(true)}
					className="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
				>
					Add Person
				</button>
			</div>

			{/* Search */}
			<div className="mb-6">
				<input
					type="text"
					placeholder="Search people..."
					value={searchQuery}
					onChange={(e) => setSearchQuery(e.target.value)}
					className="w-full max-w-md rounded-lg border px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
				/>
			</div>

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
								autoFocus
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

			{/* People List */}
			{!displayPeople || displayPeople.length === 0 ? (
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
								onClick={() => setIsAddingPerson(true)}
								className="rounded-lg bg-blue-500 px-6 py-3 text-white transition-colors hover:bg-blue-600"
							>
								Add First Person
							</button>
						</>
					)}
				</div>
			) : (
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{displayPeople.map((person) => (
						<div key={person.id} className="rounded-lg bg-white p-6 shadow-lg">
							{/* Person Avatar */}
							<div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gray-200">
								<span className="text-2xl">👤</span>
							</div>

							{/* Person Info */}
							<div className="text-center">
								<h3 className="mb-2 font-semibold text-gray-900 text-lg">
									{person.name}
								</h3>

								<div className="mb-4 space-y-1 text-gray-600 text-sm">
									<p>Face encodings: {person.faceEncodings?.length || 0}</p>
									<p>
										Added:{" "}
										{person.createdAt
											? new Date(person.createdAt).toLocaleDateString()
											: "Unknown"}
									</p>
								</div>

								{/* Action Buttons */}
								<div className="flex space-x-2">
									<button
										onClick={() => {
											// TODO: Navigate to person detail page
											alert(`View details for ${person.name}`);
										}}
										className="flex-1 rounded bg-blue-500 px-3 py-2 text-sm text-white transition-colors hover:bg-blue-600"
									>
										View Details
									</button>
									<button
										onClick={() => handleDeletePerson(person.id, person.name)}
										disabled={deletePersonMutation.isPending}
										className="rounded bg-red-500 px-3 py-2 text-sm text-white transition-colors hover:bg-red-600 disabled:bg-gray-400"
									>
										{deletePersonMutation.isPending ? "..." : "🗑️"}
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
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
