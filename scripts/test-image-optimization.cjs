const fs = require("fs").promises;
const path = require("path");
const sharp = require("sharp");

async function testImageOptimization() {
  console.log("🔍 Testing image optimization service...\n");
  
  try {
    // Read test image
    const imagePath = path.join(process.cwd(), "public", "test-images", "group-photo-1.jpg");
    const imageBuffer = await fs.readFile(imagePath);
    
    console.log("📊 Original image metadata:");
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`  Size: ${metadata.width}x${metadata.height}`);
    console.log(`  Format: ${metadata.format}`);
    console.log(`  File size: ${(imageBuffer.length / 1024).toFixed(1)} KB`);
    console.log(`  Has alpha: ${metadata.hasAlpha}\n`);
    
    // Test single optimization
    console.log("🔧 Testing single image optimization...");
    const optimized = await sharp(imageBuffer)
      .resize(800, 600, { fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    const optimizedMeta = await sharp(optimized).metadata();
    console.log(`  Optimized size: ${optimizedMeta.width}x${optimizedMeta.height}`);
    console.log(`  File size: ${(optimized.length / 1024).toFixed(1)} KB`);
    console.log(`  Compression: ${(((imageBuffer.length - optimized.length) / imageBuffer.length) * 100).toFixed(1)}%\n`);
    
    // Test creating variants
    console.log("📸 Testing image variants creation...");
    const variants = {
      thumbnail: await sharp(imageBuffer).resize(200, 200, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer(),
      medium: await sharp(imageBuffer).resize(800, 600, { fit: "inside" }).jpeg({ quality: 85 }).toBuffer(),
      large: await sharp(imageBuffer).jpeg({ quality: 90 }).toBuffer()
    };
    
    for (const [size, buffer] of Object.entries(variants)) {
      const meta = await sharp(buffer).metadata();
      console.log(`  ${size}: ${meta.width}x${meta.height} (${(buffer.length / 1024).toFixed(1)} KB)`);
    }
    
    // Save optimized images to test directory
    const optimizedDir = path.join(process.cwd(), "public", "test-images", "optimized");
    await fs.mkdir(optimizedDir, { recursive: true });
    
    for (const [size, buffer] of Object.entries(variants)) {
      const filename = `group-photo-1-${size}.jpg`;
      await fs.writeFile(path.join(optimizedDir, filename), buffer);
    }
    
    console.log(`\n✅ Image optimization test completed successfully!`);
    console.log(`📁 Optimized images saved to: public/test-images/optimized/`);
    
  } catch (error) {
    console.error("❌ Image optimization test failed:", error);
    process.exit(1);
  }
}

// Run the test
testImageOptimization();