"use client";

import { useState, useEffect } from "react";
import { api } from "~/trpc/react";

interface PhotoImageProps {
	photoId: number;
	filename: string;
	alt: string;
	className?: string;
	onLoad?: (event: React.SyntheticEvent<HTMLImageElement, Event>) => void;
}

export default function PhotoImage({ photoId, filename, alt, className, onLoad }: PhotoImageProps) {
	const [imageUrl, setImageUrl] = useState<string | null>(null);
	const [error, setError] = useState(false);

	const { data: presignedUrlData, isError } = api.photo.getPresignedUrl.useQuery(
		{ photoId },
		{
			staleTime: 30 * 60 * 1000, // Consider fresh for 30 minutes
			refetchOnWindowFocus: false,
		}
	);

	useEffect(() => {
		if (presignedUrlData?.url) {
			setImageUrl(presignedUrlData.url);
			setError(false);
		} else if (isError) {
			setError(true);
		}
	}, [presignedUrlData, isError]);

	if (error || !imageUrl) {
		return (
			<div className={`flex h-full items-center justify-center bg-gray-200 ${className}`}>
				<span className="text-gray-500 text-sm">
					{error ? "❌ Failed to load" : "⏳ Loading..."}
				</span>
			</div>
		);
	}

	return (
		<img
			src={imageUrl}
			alt={alt}
			className={className}
			onLoad={onLoad}
			onError={() => setError(true)}
		/>
	);
}