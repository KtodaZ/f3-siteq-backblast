"use client";

import FacePreview from "~/app/_components/FacePreview";

export default function TestFacePreviewPage() {
	// Mock face data for testing
	const testBoundingBox = {
		left: 0.2,
		top: 0.15,
		width: 0.3,
		height: 0.4,
	};

	const testImageUrl = "/test-images/group-photo-1.jpg";

	return (
		<div className="container mx-auto max-w-4xl px-4 py-8">
			<h1 className="mb-8 text-center font-bold text-3xl">Face Preview Test</h1>

			<div className="grid gap-8 lg:grid-cols-2">
				{/* Original Image */}
				<div className="space-y-4">
					<h2 className="font-semibold text-xl">Original Image</h2>
					<img
						src={testImageUrl}
						alt="Group of people for face recognition testing"
						className="w-full rounded-lg shadow-lg"
					/>
				</div>

				{/* Face Preview Tests */}
				<div className="space-y-4">
					<h2 className="font-semibold text-xl">Face Previews</h2>

					<div className="space-y-4">
						<div className="flex items-center space-x-4">
							<FacePreview
								imageUrl={testImageUrl}
								boundingBox={testBoundingBox}
								size={64}
								alt="Test face preview 64px"
								className="border-2 border-gray-200"
							/>
							<span>64x64px preview</span>
						</div>

						<div className="flex items-center space-x-4">
							<FacePreview
								imageUrl={testImageUrl}
								boundingBox={testBoundingBox}
								size={96}
								alt="Test face preview 96px"
								className="border-2 border-gray-200"
							/>
							<span>96x96px preview</span>
						</div>

						<div className="flex items-center space-x-4">
							<FacePreview
								imageUrl={testImageUrl}
								boundingBox={testBoundingBox}
								size={128}
								alt="Test face preview 128px"
								className="border-2 border-gray-200"
							/>
							<span>128x128px preview</span>
						</div>
					</div>

					{/* Multiple face examples */}
					<div className="mt-8">
						<h3 className="mb-4 font-semibold text-lg">
							Multiple Face Examples
						</h3>
						<div className="flex space-x-4">
							<FacePreview
								imageUrl={testImageUrl}
								boundingBox={{ left: 0.1, top: 0.2, width: 0.25, height: 0.35 }}
								size={64}
								alt="Face 1"
								className="border-2 border-green-200"
							/>
							<FacePreview
								imageUrl={testImageUrl}
								boundingBox={{ left: 0.4, top: 0.1, width: 0.3, height: 0.4 }}
								size={64}
								alt="Face 2"
								className="border-2 border-blue-200"
							/>
							<FacePreview
								imageUrl={testImageUrl}
								boundingBox={{
									left: 0.7,
									top: 0.25,
									width: 0.25,
									height: 0.35,
								}}
								size={64}
								alt="Face 3"
								className="border-2 border-purple-200"
							/>
						</div>
					</div>

					{/* Bounding box info */}
					<div className="mt-8 rounded-lg bg-gray-50 p-4">
						<h3 className="mb-2 font-semibold text-lg">Test Bounding Box</h3>
						<pre className="text-gray-600 text-sm">
							{JSON.stringify(testBoundingBox, null, 2)}
						</pre>
					</div>
				</div>
			</div>
		</div>
	);
}
