"use client";

import { type ChangeEvent, type DragEvent, useCallback, useState } from "react";
import { api } from "~/trpc/react";

interface UploadedFile {
	file: File;
	id: string;
	status: "pending" | "uploading" | "success" | "error";
	progress: number;
}

export default function UploadPage() {
	const [files, setFiles] = useState<UploadedFile[]>([]);
	const [isDragging, setIsDragging] = useState(false);

	const uploadPhoto = api.photo.upload.useMutation();

	const handleFileSelect = useCallback((selectedFiles: FileList | File[]) => {
		const fileArray = Array.from(selectedFiles);
		const validFiles = fileArray.filter((file) => {
			const isValidType = ["image/jpeg", "image/png", "image/webp"].includes(
				file.type,
			);
			const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB
			return isValidType && isValidSize;
		});

		const newFiles: UploadedFile[] = validFiles.map((file) => ({
			file,
			id: Math.random().toString(36).substring(7),
			status: "pending",
			progress: 0,
		}));

		setFiles((prev) => [...prev, ...newFiles]);
	}, []);

	const handleDrop = useCallback(
		(e: DragEvent<HTMLDivElement>) => {
			e.preventDefault();
			setIsDragging(false);

			if (e.dataTransfer.files) {
				handleFileSelect(e.dataTransfer.files);
			}
		},
		[handleFileSelect],
	);

	const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
		e.preventDefault();
		setIsDragging(false);
	}, []);

	const handleFileInput = useCallback(
		(e: ChangeEvent<HTMLInputElement>) => {
			if (e.target.files) {
				handleFileSelect(e.target.files);
			}
		},
		[handleFileSelect],
	);

	const uploadFile = useCallback(
		async (uploadedFile: UploadedFile) => {
			setFiles((prev) =>
				prev.map((f) =>
					f.id === uploadedFile.id ? { ...f, status: "uploading" as const } : f,
				),
			);

			try {
				// Convert file to base64 for upload
				const base64 = await new Promise<string>((resolve) => {
					const reader = new FileReader();
					reader.onload = () => resolve(reader.result as string);
					reader.readAsDataURL(uploadedFile.file);
				});

				await uploadPhoto.mutateAsync({
					filename: uploadedFile.file.name,
					fileData: base64,
					fileSize: uploadedFile.file.size,
				});

				// Update file status to success
				setFiles((prev) =>
					prev.map((f) =>
						f.id === uploadedFile.id
							? { ...f, status: "success" as const, progress: 100 }
							: f,
					),
				);
			} catch (error) {
				// Update file status to error
				setFiles((prev) =>
					prev.map((f) =>
						f.id === uploadedFile.id ? { ...f, status: "error" as const } : f,
					),
				);
			}
		},
		[uploadPhoto],
	);

	const uploadAllFiles = useCallback(() => {
		const pendingFiles = files.filter((f) => f.status === "pending");
		pendingFiles.forEach(uploadFile);
	}, [files, uploadFile]);

	const removeFile = useCallback((id: string) => {
		setFiles((prev) => prev.filter((f) => f.id !== id));
	}, []);

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8">
			<h1 className="mb-8 text-center font-bold text-3xl">
				Upload Photos for Face Recognition
			</h1>

			{/* Upload Area */}
			<div
				className={`mb-6 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
					isDragging
						? "border-blue-500 bg-blue-50"
						: "border-gray-300 hover:border-gray-400"
				}`}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
			>
				<div className="space-y-4">
					<div className="text-6xl text-gray-400">📸</div>
					<div>
						<p className="font-medium text-gray-700 text-lg">
							Drag and drop photos here, or click to select
						</p>
						<p className="mt-2 text-gray-500 text-sm">
							Supports JPEG, PNG, WebP up to 10MB each
						</p>
					</div>
					<input
						type="file"
						multiple
						accept="image/jpeg,image/png,image/webp"
						onChange={handleFileInput}
						className="hidden"
						id="file-input"
					/>
					<label
						htmlFor="file-input"
						className="inline-block cursor-pointer rounded-lg bg-blue-500 px-6 py-2 text-white transition-colors hover:bg-blue-600"
					>
						Select Photos
					</label>
				</div>
			</div>

			{/* Mobile Camera Capture */}
			<div className="mb-6 sm:hidden">
				<input
					type="file"
					accept="image/*"
					capture="environment"
					onChange={handleFileInput}
					className="hidden"
					id="camera-input"
				/>
				<label
					htmlFor="camera-input"
					className="block w-full cursor-pointer rounded-lg bg-green-500 px-6 py-3 text-center text-white transition-colors hover:bg-green-600"
				>
					📷 Take Photo with Camera
				</label>
			</div>

			{/* File List */}
			{files.length > 0 && (
				<div className="mb-6 space-y-4">
					<div className="flex items-center justify-between">
						<h2 className="font-semibold text-xl">
							Selected Photos ({files.length})
						</h2>
						<button
							type="button"
							onClick={uploadAllFiles}
							disabled={
								files.every((f) => f.status !== "pending") ||
								uploadPhoto.isPending
							}
							className="rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-400"
						>
							Upload All
						</button>
					</div>

					<div className="space-y-2">
						{files.map((uploadedFile) => (
							<div
								key={uploadedFile.id}
								className="flex items-center justify-between rounded-lg bg-gray-50 p-4"
							>
								<div className="flex flex-1 items-center space-x-3">
									<div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200">
										<img
											src={URL.createObjectURL(uploadedFile.file)}
											alt={uploadedFile.file.name}
											className="h-full w-full object-cover"
										/>
									</div>
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium text-gray-900">
											{uploadedFile.file.name}
										</p>
										<p className="text-gray-500 text-sm">
											{(uploadedFile.file.size / 1024 / 1024).toFixed(1)} MB
										</p>
									</div>
								</div>

								<div className="flex items-center space-x-3">
									{/* Status Indicator */}
									<div className="flex items-center space-x-2">
										{uploadedFile.status === "pending" && (
											<span className="text-yellow-600">⏳ Pending</span>
										)}
										{uploadedFile.status === "uploading" && (
											<span className="text-blue-600">⬆️ Uploading...</span>
										)}
										{uploadedFile.status === "success" && (
											<span className="text-green-600">✅ Uploaded</span>
										)}
										{uploadedFile.status === "error" && (
											<span className="text-red-600">❌ Error</span>
										)}
									</div>

									{/* Action Buttons */}
									{uploadedFile.status === "pending" && (
										<button
											type="button"
											onClick={() => uploadFile(uploadedFile)}
											disabled={uploadPhoto.isPending}
											className="font-medium text-blue-600 hover:text-blue-800"
										>
											Upload
										</button>
									)}

									<button
										type="button"
										onClick={() => removeFile(uploadedFile.id)}
										className="font-medium text-red-600 hover:text-red-800"
									>
										Remove
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Instructions */}
			<div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
				<h3 className="mb-2 font-semibold text-blue-900">
					Tips for Best Results:
				</h3>
				<ul className="space-y-1 text-blue-800 text-sm">
					<li>• Use photos with clear, well-lit faces</li>
					<li>• Group photos work best with 15-20 people</li>
					<li>• Avoid blurry or low-resolution images</li>
					<li>• Processing typically takes 1-2 minutes per photo</li>
				</ul>
			</div>
		</div>
	);
}
