import Link from "next/link";
import { HydrateClient } from "~/trpc/server";

export default function Home() {
	return (
		<HydrateClient>
			<div className="container mx-auto px-4 py-12">
				{/* Hero Section */}
				<div className="mb-16 text-center">
					<h1 className="mb-6 font-bold text-5xl text-gray-900">
						F3 Face Recognition
					</h1>
					<p className="mx-auto mb-8 max-w-3xl text-gray-600 text-xl">
						AI-powered face recognition for group photos. Upload photos,
						identify people, and build a searchable database of your community
						events.
					</p>
					<div className="flex flex-col justify-center gap-4 sm:flex-row">
						<Link
							href="/upload"
							className="rounded-lg bg-blue-500 px-8 py-3 font-medium text-lg text-white transition-colors hover:bg-blue-600"
						>
							Upload Photos
						</Link>
						<Link
							href="/photos"
							className="rounded-lg bg-gray-100 px-8 py-3 font-medium text-gray-900 text-lg transition-colors hover:bg-gray-200"
						>
							View Gallery
						</Link>
					</div>
				</div>

				{/* Features */}
				<div className="mb-16 grid gap-8 md:grid-cols-3">
					<div className="rounded-lg bg-white p-6 text-center shadow-lg">
						<div className="mb-4 text-4xl">🔍</div>
						<h3 className="mb-2 font-semibold text-xl">Smart Recognition</h3>
						<p className="text-gray-600">
							Advanced AI automatically detects and recognizes faces in group
							photos with high accuracy.
						</p>
					</div>
					<div className="rounded-lg bg-white p-6 text-center shadow-lg">
						<div className="mb-4 text-4xl">⚡</div>
						<h3 className="mb-2 font-semibold text-xl">Fast Processing</h3>
						<p className="text-gray-600">
							Process photos with 15-20 people in under 2 minutes using
							cloud-based processing.
						</p>
					</div>
					<div className="rounded-lg bg-white p-6 text-center shadow-lg">
						<div className="mb-4 text-4xl">👥</div>
						<h3 className="mb-2 font-semibold text-xl">People Management</h3>
						<p className="text-gray-600">
							Build and manage a database of people with smart face matching and
							organization.
						</p>
					</div>
				</div>

				{/* How it Works */}
				<div className="mb-16 rounded-xl bg-gray-50 p-8">
					<h2 className="mb-8 text-center font-bold text-3xl">How It Works</h2>
					<div className="grid gap-6 md:grid-cols-4">
						<div className="text-center">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 font-bold text-white text-xl">
								1
							</div>
							<h4 className="mb-2 font-semibold">Upload Photos</h4>
							<p className="text-gray-600 text-sm">
								Drag and drop or select photos from your device
							</p>
						</div>
						<div className="text-center">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 font-bold text-white text-xl">
								2
							</div>
							<h4 className="mb-2 font-semibold">AI Processing</h4>
							<p className="text-gray-600 text-sm">
								Our AI detects and analyzes faces in your photos
							</p>
						</div>
						<div className="text-center">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 font-bold text-white text-xl">
								3
							</div>
							<h4 className="mb-2 font-semibold">Identify People</h4>
							<p className="text-gray-600 text-sm">
								Add names to faces and build your database
							</p>
						</div>
						<div className="text-center">
							<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500 font-bold text-white text-xl">
								4
							</div>
							<h4 className="mb-2 font-semibold">Smart Recognition</h4>
							<p className="text-gray-600 text-sm">
								Future photos automatically recognize known people
							</p>
						</div>
					</div>
				</div>

				{/* Stats */}
				<div className="rounded-xl bg-blue-500 p-8 text-center text-white">
					<h2 className="mb-6 font-bold text-2xl">Powerful & Efficient</h2>
					<div className="grid gap-8 md:grid-cols-3">
						<div>
							<div className="mb-2 font-bold text-3xl">95%+</div>
							<div className="text-blue-100">Recognition Accuracy</div>
						</div>
						<div>
							<div className="mb-2 font-bold text-3xl">&lt;2 min</div>
							<div className="text-blue-100">Processing Time</div>
						</div>
						<div>
							<div className="mb-2 font-bold text-3xl">20+</div>
							<div className="text-blue-100">People per Photo</div>
						</div>
					</div>
				</div>
			</div>
		</HydrateClient>
	);
}
