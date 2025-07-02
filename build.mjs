import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

console.log('This script will build the Megacubo APKs for ARM and ARM64 architectures, building PC installers is not covered yet. Remember to run \'npm run prepare\' before running this script.');

// Get __dirname in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Constants
const RELEASE_DIRECTORY = path.join(__dirname, "releases");
const APK_OUTPUT_DIRECTORY = path.join(__dirname, "android", "app", "build", "outputs", "apk", "release");
const BUILD_GRADLE_FILE_PATH = path.join(__dirname, "android", "app", "build.gradle");
const DISTRIBUTION_DIRECTORY = path.join(__dirname, "android", "app", "src", "main", "assets", "public", "nodejs", "dist");
const PACKAGE_JSON_PATH = path.join(__dirname, "package.json");
const SIGNING_PROPERTIES_PATH = path.join(__dirname, "release-signing.properties");

// Function to retrieve the application version from package.json
const getApplicationVersion = async () => {
  const { default: { version } } = await import("file://" + PACKAGE_JSON_PATH, { with: { type: "json" } });
  return version || "";
};

// Function to read signing properties from the properties file
const readSigningProperties = () => {
  const properties = {};
  if (fs.existsSync(SIGNING_PROPERTIES_PATH)) {
    const content = fs.readFileSync(SIGNING_PROPERTIES_PATH, "utf-8").split("\n");
    content.forEach(line => {
      const [key, value] = line.split("=");
      if (key && value) {
        properties[key.trim()] = value.trim();
      }
    });
  }
  if(properties.storeFile && (properties.storeFile.startsWith(".") || !(properties.storeFile.includes("/") || properties.storeFile.includes("\\")))) {
    properties.storeFile = path.join(__dirname, properties.storeFile);
  }
  return properties;
};

// Update build.gradle file to include specified ABI
const updateBuildGradleWithABI = (abi) => {
  let gradleContent = fs.readFileSync(BUILD_GRADLE_FILE_PATH, "utf-8");
  gradleContent = gradleContent.replace(/include \x27[a-z0-9\- ,\x27]+/g, `include '${abi}'`);
  fs.writeFileSync(BUILD_GRADLE_FILE_PATH, gradleContent);
};

// Execute shell command with error handling
const executeCommand = (command) => {
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    console.error(`Command failed: ${command}`);
    process.exit(error.status);
  }
};

// Main build process
const buildApplication = async () => {
  const applicationVersion = await getApplicationVersion();
  const signingProperties = readSigningProperties();

  if (!applicationVersion || !/^[0-9]+(\.[0-9]+)*$/.test(applicationVersion)) {
    console.error(`Application version is invalid or empty: ${applicationVersion}`);
    process.exit(1);
  }

  console.log(`Application Version: ${applicationVersion}`);

  const signedApkPath = path.join(APK_OUTPUT_DIRECTORY, "app-release-signed.apk");
  const unsignedApkPath = path.join(APK_OUTPUT_DIRECTORY, "app-release-unsigned.apk");
  
  if (fs.existsSync(signedApkPath)) {
    fs.unlinkSync(signedApkPath);
  }
  
  if (fs.existsSync(unsignedApkPath)) {
    fs.unlinkSync(unsignedApkPath);
  }
  
  // ARM64 build process
  updateBuildGradleWithABI("arm64-v8a");
  if (fs.existsSync(path.join(DISTRIBUTION_DIRECTORY, "premium.js"))) {
    fs.unlinkSync(path.join(DISTRIBUTION_DIRECTORY, "premium.js"));
  }

  const arm64PremiumFilePath = path.join(__dirname, "compiled_premium", "premium-arm64.jsc");
  const destinationPremiumFilePath = path.join(DISTRIBUTION_DIRECTORY, "premium.jsc");

  // Copy ARM64 premium file if it exists
  if (fs.existsSync(arm64PremiumFilePath)) {
    fs.copyFileSync(arm64PremiumFilePath, destinationPremiumFilePath);
  }

  // Build command
  let buildCommand = `npx cap build android`;

  if (signingProperties.storeFile && signingProperties.storePassword && signingProperties.keyAlias && signingProperties.keyPassword) {
    console.log("Signing properties found. Signing APK...");
    buildCommand += ` --keystorepath ${signingProperties.storeFile} --keystorepass ${signingProperties.storePassword} --keystorealias ${signingProperties.keyAlias} --keystorealiaspass ${signingProperties.keyPassword}`;
  } else {
    console.log("Signing properties not found. Building unsigned APK...");
}

  buildCommand += ` --androidreleasetype APK --signing-type apksigner`;
  executeCommand(buildCommand);

  const signedApkMtime = fs.existsSync(signedApkPath) ? fs.statSync(signedApkPath).mtime : 0;
  const unsignedApkMtime = fs.existsSync(unsignedApkPath) ? fs.statSync(unsignedApkPath).mtime : 0;
  
  const outputApkPath = signedApkMtime > unsignedApkMtime ? signedApkPath : unsignedApkPath;
  fs.renameSync(outputApkPath, path.join(RELEASE_DIRECTORY, `Megacubo_${applicationVersion}_android_arm64-v8a.apk`));

  // ARM build process
  updateBuildGradleWithABI("armeabi-v7a");

  const armPremiumFilePath = path.join(__dirname, "compiled_premium", "premium-arm.jsc");
  
  // Copy ARM premium file if it exists
  if (fs.existsSync(armPremiumFilePath)) {
    fs.copyFileSync(armPremiumFilePath, destinationPremiumFilePath);
  }

  console.log("Building ARM as last to keep project files with ARM as default instead of ARM64...");
  
  // Resetting buildCommand for ARM build
  buildCommand = `npx cap build android`;

  if (signingProperties.storeFile && signingProperties.storePassword && signingProperties.keyAlias && signingProperties.keyPassword) {
    buildCommand += ` --keystorepath ${signingProperties.storeFile} --keystorepass ${signingProperties.storePassword} --keystorealias ${signingProperties.keyAlias} --keystorealiaspass ${signingProperties.keyPassword}`;
  }

  buildCommand += ` --androidreleasetype APK --signing-type apksigner`;
  executeCommand(buildCommand);

  fs.renameSync(
    outputApkPath,
    path.join(RELEASE_DIRECTORY, `Megacubo_${applicationVersion}_android_armeabi-v7a.apk`)
  );

  console.log(`Finished: ${new Date().toLocaleString()}`);
};

buildApplication().catch(error => console.error("Build failed:", error));
